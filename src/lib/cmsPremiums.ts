// CMS Medigap rate loader. Data lives in pm_supp_carrier_rates and is
// fetched via /api/rates. The scoring engine stays synchronous: callers
// must prefetchRates(zip, gender) before scoreApplication() runs.
//
// The cache is a process-lifetime Map; concurrent prefetches for the same
// key share the same in-flight promise so we never double-fetch.

export type Plan = 'G' | 'N';
export type Gender = 'MALE' | 'FEMALE';
export type RateType = 'ATTAINED_AGE' | 'ISSUE_AGE' | 'COMMUNITY_RATED';

export interface CarrierRate {
  /** Carrier name as CMS files it (subsidiary suffix included). */
  company: string;
  /** Age-65, non-tobacco monthly premium in dollars. */
  rate: number;
  rateType: RateType;
  /** Household discount — standard form, when filed. */
  hhdStandard?: number;
  /** Household discount — roommate/cohabitant form, when filed. */
  hhdRoommate?: number;
}

interface Bundle {
  state: string;
  refZip: string;
  rates: Record<Plan, CarrierRate[]>;
}

interface ApiResponse {
  ok: boolean;
  state?: string;
  refZip?: string;
  rates?: Record<Plan, CarrierRate[]>;
  error?: string;
}

function normalizeZip(zip: string): string {
  return (zip || '').replace(/[^0-9]/g, '').padEnd(5, '0').slice(0, 5);
}

function cacheKey(zip: string, gender: Gender): string {
  return `${normalizeZip(zip)}:${gender}`;
}

const cache = new Map<string, Bundle>();
const inflight = new Map<string, Promise<Bundle>>();

/** Fetch rates for (zip, gender) and cache them. Idempotent: subsequent
 *  calls with the same key return the cached bundle without a round trip. */
export async function prefetchRates(zip: string, gender: Gender): Promise<Bundle> {
  const key = cacheKey(zip, gender);
  const cached = cache.get(key);
  if (cached) return cached;
  const existing = inflight.get(key);
  if (existing) return existing;

  const safeZip = normalizeZip(zip);
  const promise = (async () => {
    const resp = await fetch(
      `/api/rates?zip=${encodeURIComponent(safeZip)}&gender=${encodeURIComponent(gender)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!resp.ok) {
      throw new Error(`Rate fetch ${resp.status}`);
    }
    const body = (await resp.json()) as ApiResponse;
    if (!body.ok || !body.rates || !body.state || !body.refZip) {
      throw new Error(body.error ?? 'Rate fetch returned no rates');
    }
    const bundle: Bundle = {
      state: body.state,
      refZip: body.refZip,
      rates: { G: body.rates.G ?? [], N: body.rates.N ?? [] },
    };
    cache.set(key, bundle);
    return bundle;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

/** Synchronous lookup against the in-memory cache. Returns [] if the
 *  caller forgot to prefetchRates(zip, gender) first. */
export function lookupRates(zip: string, plan: Plan, gender: Gender): CarrierRate[] {
  const bundle = cache.get(cacheKey(zip, gender));
  return bundle?.rates[plan] ?? [];
}

/** Test-only: drop all cached bundles. */
export function _clearRateCache(): void {
  cache.clear();
  inflight.clear();
}

// ─── Carrier name → underwriting rule-name mapping ──────────────────────
//
// Only carriers with carrier-specific logic in scoringEngine need an entry;
// everyone else falls through to the generic scoring path.

const RULE_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/^Mutual of Omaha/i, 'Mutual of Omaha'],
  [/^Humana/i, 'Humana'],
  [/^Bankers Fidelity/i, 'Bankers Fidelity'],
  [/^Aetna/i, 'Aetna'],
  [/Aetna\)$/i, 'Aetna'],
  [/^Cigna/i, 'Cigna'],
  [/^HealthSpring/i, 'Cigna'],
  [/^BlueCross BlueShield of North Carolina/i, 'BCBS of NC'],
];

/** Return the rule-name our scoring engine uses for this CMS carrier,
 *  or null if no special carrier rule applies. */
export function carrierRuleName(company: string): string | null {
  for (const [pat, name] of RULE_NAME_PATTERNS) {
    if (pat.test(company)) return name;
  }
  return null;
}
