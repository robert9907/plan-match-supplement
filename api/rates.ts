// GET /api/rates?zip=XXXXX&gender=FEMALE|MALE
//
// Returns CMS Medigap rates for the nearest sampled ZIP in the same state.
// The CMS Plan Finder scrape covers 12 representative ZIPs per state across
// NC / TX / GA. For ZIPs we did not sample, we fall back to the same-state
// reference ZIP with the longest leading-prefix match.
//
// Response:
//   { ok: true, state, refZip, rates: { G: CarrierRate[], N: CarrierRate[] } }
//   { ok: false, error: "…" }
//
// Auth: server-side service-role key. As of migration 005, anon has no
// SELECT on the base pm_supp_carrier_rates table — reads go through the
// pm_supp_carrier_rates_public view, which filters carriers listed in
// pm_medsup_carrier_exclusions. Service role bypasses the revoke.

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ─── Types ──────────────────────────────────────────────────────────────

type Gender = 'MALE' | 'FEMALE';
type Plan = 'G' | 'N';
type RateType = 'ATTAINED_AGE' | 'ISSUE_AGE' | 'COMMUNITY_RATED';

interface CarrierRate {
  company: string;
  rate: number;
  rateType: RateType;
  hhdStandard?: number;
  hhdRoommate?: number;
}

interface DbRow {
  company: string;
  plan: Plan;
  rate_type: RateType;
  rate_min: string;
  hhd_std_min: string | null;
  hhd_rm_min: string | null;
}

// ─── ZIP → state + reference ZIP ────────────────────────────────────────
//
// The scrape covers exactly these ZIPs. Outside this list, fall back to
// the in-state reference ZIP with the longest leading-prefix match (then
// smallest numeric distance as the tiebreaker).

const REFERENCE_ZIPS: Record<string, string[]> = {
  NC: ['27101', '27401', '27514', '27601', '27713', '27858',
       '28202', '28401', '28540', '28655', '28677', '28801'],
  TX: ['73301', '75201', '75701', '76101', '76301', '77001',
       '77901', '78201', '78401', '79101', '79601', '79901'],
  GA: ['30005', '30060', '30301', '30501', '30601', '30701',
       '30901', '31061', '31201', '31401', '31501', '31601'],
};

function stateForZip(zip: string): keyof typeof REFERENCE_ZIPS {
  const n = parseInt(zip.slice(0, 3), 10);
  if (n >= 270 && n <= 289) return 'NC';
  if (n >= 750 && n <= 799) return 'TX';
  if (n === 733) return 'TX';
  if (n >= 300 && n <= 319) return 'GA';
  if (n >= 398 && n <= 399) return 'GA';
  return 'NC';
}

function nearestReferenceZip(zip: string): { state: keyof typeof REFERENCE_ZIPS; refZip: string } {
  const state = stateForZip(zip);
  const candidates = REFERENCE_ZIPS[state];
  let best = candidates[0];
  let bestPrefix = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  const target = parseInt(zip, 10);
  for (const ref of candidates) {
    let prefix = 0;
    while (prefix < 5 && zip[prefix] === ref[prefix]) prefix++;
    const dist = Math.abs(parseInt(ref, 10) - target);
    if (prefix > bestPrefix || (prefix === bestPrefix && dist < bestDist)) {
      best = ref;
      bestPrefix = prefix;
      bestDist = dist;
    }
  }
  return { state, refZip: best };
}

// ─── Supabase fetch ─────────────────────────────────────────────────────

async function fetchRates(
  state: string,
  refZip: string,
  gender: Gender,
): Promise<DbRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  // Both plans in a single request — keeps it under the PostgREST row cap
  // (≤ ~80 rows per call) and saves a round trip.
  const qs = new URLSearchParams({
    state: `eq.${state}`,
    zip: `eq.${refZip}`,
    gender: `eq.${gender}`,
    select: 'company,plan,rate_type,rate_min,hhd_std_min,hhd_rm_min',
  });
  const resp = await fetch(`${url.replace(/\/$/, '')}/rest/v1/pm_supp_carrier_rates_public?${qs}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase rate fetch ${resp.status}: ${text.slice(0, 300)}`);
  }
  return (await resp.json()) as DbRow[];
}

function shapeRow(row: DbRow): CarrierRate {
  const rate = parseFloat(row.rate_min);
  const out: CarrierRate = {
    company: row.company,
    rate: Number.isFinite(rate) ? rate : 0,
    rateType: row.rate_type,
  };
  if (row.hhd_std_min != null) {
    const v = parseFloat(row.hhd_std_min);
    if (Number.isFinite(v)) out.hhdStandard = v;
  }
  if (row.hhd_rm_min != null) {
    const v = parseFloat(row.hhd_rm_min);
    if (Number.isFinite(v)) out.hhdRoommate = v;
  }
  return out;
}

// ─── Handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const rawZip = String(req.query.zip ?? '').replace(/\D/g, '');
  const rawGender = String(req.query.gender ?? '').toUpperCase();
  if (rawZip.length < 3) {
    res.status(400).json({ ok: false, error: 'zip required (5 digits)' });
    return;
  }
  if (rawGender !== 'FEMALE' && rawGender !== 'MALE') {
    res.status(400).json({ ok: false, error: 'gender must be FEMALE or MALE' });
    return;
  }
  const zip = rawZip.padEnd(5, '0').slice(0, 5);
  const gender = rawGender as Gender;

  try {
    const { state, refZip } = nearestReferenceZip(zip);
    const rows = await fetchRates(state, refZip, gender);
    const rates: Record<Plan, CarrierRate[]> = { G: [], N: [] };
    for (const row of rows) {
      if (row.plan === 'G' || row.plan === 'N') {
        rates[row.plan].push(shapeRow(row));
      }
    }
    // Cache aggressively at the edge — the underlying data only changes
    // when we re-run the seed script against a refreshed CMS scrape.
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, state, refZip, rates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/rates]', message);
    res.status(500).json({ ok: false, error: message });
  }
}
