// GET /api/medsup-rates?state=NC
//
// Returns age-banded Plan G monthly premiums for every active carrier in a
// state, shaped for the RateProjectionWidget. Data source: pm_medsup_rate
// joined with pm_medsup_carrier in the consumer plan-match Supabase
// (rpcbrkmvalvdmroqzpaq — same project this repo already uses for the CMS
// Plan Finder rates in api/rates.ts).
//
// Response:
//   { ok: true, state, carriers: [{ n, c, ra, M: {age:premium}, F:{age:premium} }] }
//   { ok: false, error: "…" }
//
// PostgREST 1000-row cap (memory: feedback_postgrest_row_cap) — one state at
// plan G is ~682 rows (11 carriers × 31 ages × 2 genders). NC currently ships
// 163 rows. We still page via .range() defensively so a future TX/GA scrape
// can't silently truncate.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const PAGE_SIZE = 500;

// Fixed palette assigned to carriers in alphabetical order — colors stay
// stable across rebuilds. Mirrors the gh-cc-v4 medsupData.js palette so
// embed-rendered widgets and the in-app widget look the same.
const PALETTE = [
  '#00D4AA', '#4B9CD3', '#FFC72C', '#E76F51',
  '#9B5DE5', '#2EC4B6', '#F77F00', '#06AED5',
  '#EF476F', '#7FB069', '#118AB2', '#D62828',
  '#8338EC',
];

type Gender = 'M' | 'F';

interface RawRow {
  age: number | string;
  gender: string;
  monthly_premium: number | string;
  pm_medsup_carrier: {
    carrier_name: string;
    state: string;
    rating_type: string | null;
    active: boolean;
  } | null;
}

export interface MedsupCarrier {
  n: string;
  c: string;
  ra: string | null;
  M: Record<number, number>;
  F: Record<number, number>;
}

function normalizeGender(g: string): Gender | null {
  const s = String(g).trim().toLowerCase();
  if (s === 'm' || s === 'male') return 'M';
  if (s === 'f' || s === 'female') return 'F';
  return null;
}

async function fetchAllPages(state: string): Promise<RawRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }
  const base = url.replace(/\/$/, '');
  const all: RawRow[] = [];
  let from = 0;
  for (;;) {
    const qs = new URLSearchParams({
      plan_letter: 'eq.G',
      tobacco: 'eq.false',
      'pm_medsup_carrier.state': `eq.${state}`,
      'pm_medsup_carrier.active': 'eq.true',
      select:
        'age,gender,monthly_premium,pm_medsup_carrier!inner(carrier_name,state,rating_type,active)',
      order: 'age.asc',
    });
    const resp = await fetch(`${base}/rest/v1/pm_medsup_rate?${qs}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Range: `${from}-${from + PAGE_SIZE - 1}`,
        Prefer: 'count=exact',
      },
    });
    if (!resp.ok && resp.status !== 206) {
      const text = await resp.text();
      throw new Error(`Supabase medsup fetch ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = (await resp.json()) as RawRow[];
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function shape(rows: RawRow[]): MedsupCarrier[] {
  const byCarrier = new Map<string, { ra: string | null; M: Record<number, number>; F: Record<number, number> }>();
  for (const r of rows) {
    const c = r.pm_medsup_carrier;
    if (!c) continue;
    const name = c.carrier_name;
    const g = normalizeGender(r.gender);
    const age = Number(r.age);
    const premium = Number(r.monthly_premium);
    if (!name || !g || !Number.isFinite(age) || !Number.isFinite(premium)) continue;

    if (!byCarrier.has(name)) {
      byCarrier.set(name, { ra: c.rating_type ?? null, M: {}, F: {} });
    }
    byCarrier.get(name)![g][age] = premium;
  }
  const names = Array.from(byCarrier.keys()).sort((a, b) => a.localeCompare(b));
  return names.map((n, i) => ({
    n,
    c: PALETTE[i % PALETTE.length],
    ra: byCarrier.get(n)!.ra,
    M: byCarrier.get(n)!.M,
    F: byCarrier.get(n)!.F,
  }));
}

const ALLOWED_STATES = new Set(['NC']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  const state = String(req.query.state ?? '').toUpperCase();
  if (state.length !== 2) {
    res.status(400).json({ ok: false, error: 'state required (2-letter abbr)' });
    return;
  }
  // Outside NC we have no rate filings yet. Return an explicit empty list
  // so the widget can show its "Coming to <state> soon" fallback instead of
  // spinning forever or throwing a 500.
  if (!ALLOWED_STATES.has(state)) {
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, state, carriers: [] });
    return;
  }
  try {
    const rows = await fetchAllPages(state);
    const carriers = shape(rows);
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json({ ok: true, state, carriers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/medsup-rates]', message);
    res.status(500).json({ ok: false, error: message });
  }
}
