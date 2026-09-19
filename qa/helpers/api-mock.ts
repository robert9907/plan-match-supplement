// ---------------------------------------------------------------------------
// api-mock.ts — deterministic, offline API for the compliance run.
//
// Why mock rather than point at production, which is what the MA consumer
// harness does:
//
//   1. The gate has to be able to run this against HEAD. Pointing at
//      planmatch.generationhealth.me tests whatever is deployed, which is the
//      exact reason fullAudit was never enabled in the consumer repo.
//   2. A compliance run must be deterministic. If the report goes red because
//      a rate row changed overnight, nobody trusts it a week later.
//   3. Rate data is PHI-adjacent and rate-filing-sensitive. A test suite that
//      pulls live carrier rates on every push is a data-handling question
//      nobody needs to answer.
//
// What is being tested here is the SURFACE — the disclosures, the copy, the
// gating, the consent mechanics. The data only has to be shaped correctly and
// cover the branches. Whether production returns the right numbers is the
// job of the medsup-view check and the DB-side suppression audit.
//
// page.route() is used rather than a proxy so the absolute-URL calls to the
// shared library API (drug search, NPI search) and the Supabase analytics
// beacon are intercepted too. Nothing in this run touches the network.
// ---------------------------------------------------------------------------

import type { Page, Route } from '@playwright/test';
import type { Persona } from '../fixtures/personas.js';
import { TX_PROJECTION } from '../fixtures/tx-projection.js';

type RateType = 'ATTAINED_AGE' | 'ISSUE_AGE' | 'COMMUNITY_RATED';

interface CarrierRate {
  company: string;
  rate: number;
  rateType: RateType;
  /**
   * The monthly premium under the carrier's household form — NOT the saving.
   * This fixture previously carried fractions (0.12, 0.05, 0.10) on the
   * assumption that the field was a percentage, which is how the suite came
   * to render "$0/mo" once the rule against zero-dollar premiums landed. The
   * real column (pm_supp_carrier_rates.hhd_std_min / hhd_rm_min) is a premium
   * averaging 95.5% of rate_min across 3,384 rows. Keep these premium-shaped
   * or the fixture stops describing production.
   */
  hhdStandardPremium?: number;
  hhdRoommatePremium?: number;
}

// Carrier names are real filings, chosen so scoringEngine's carrier-specific
// rules (Mutual of Omaha, Aetna, Cigna, Humana, BCBS of NC) actually fire.
// None of them is on the migration-005 suppression list — a suppressed carrier
// must never be reachable, and putting one in a fixture would normalise it.
// Household premiums here sit at 0.88-0.94 of the standard rate, the band
// production actually occupies, so discountCopy has a real difference to
// report. HealthSpring is deliberately the exception: it files hhd at exactly
// 1.740x rate_min in all 192 of its rows across NC and TX, a scraper column
// error rather than a discount, and the widget must state nothing rather than
// invent a saving from it.
const CARRIERS_G: CarrierRate[] = [
  { company: 'Mutual of Omaha Insurance Company', rate: 142.35, rateType: 'ATTAINED_AGE', hhdStandardPremium: 133.81 },
  { company: 'Aetna Health Insurance Company', rate: 151.8, rateType: 'ATTAINED_AGE', hhdStandardPremium: 141.17 },
  { company: 'Cigna National Health Insurance Company', rate: 138.9, rateType: 'ISSUE_AGE' },
  { company: 'Humana Medicare Supplement', rate: 164.25, rateType: 'ATTAINED_AGE', hhdRoommatePremium: 145.2 },
  { company: 'Blue Medicare Supplement (BCBSNC)', rate: 173.0, rateType: 'COMMUNITY_RATED' },
  { company: 'HealthSpring Insurance Company', rate: 149.5, rateType: 'ATTAINED_AGE', hhdRoommatePremium: 260.13 },
];

// Scale the household premium with the rate. Carrying the Plan G figure onto a
// Plan N rate 18% lower would put every household premium above its own plan's
// rate and silently suppress the line for the wrong reason.
const scale = (v: number | undefined, f: number): number | undefined =>
  v == null ? undefined : Math.round((v * f + Number.EPSILON) * 100) / 100;

const CARRIERS_N: CarrierRate[] = [
  ...CARRIERS_G.map((c) => ({
    ...c,
    rate: Math.round((c.rate * 0.82 + Number.EPSILON) * 100) / 100,
    hhdStandardPremium: scale(c.hhdStandardPremium, 0.82),
    hhdRoommatePremium: scale(c.hhdRoommatePremium, 0.82),
  })),
  // Plan N only. buildCarrierMap seeds gRate: 0 for this carrier, so a
  // discount computed as `gRate - gHhdPremium` is a large negative rather than
  // a zero — the case a `<= 0` guard lets through and a `> 0` guard catches.
  { company: 'Nassau Life Insurance Company', rate: 121.4, rateType: 'ATTAINED_AGE', hhdRoommatePremium: 112.9 },
];

const PALETTE = ['#0d2f5e', '#1f6feb', '#2da44e', '#bf8700', '#8250df'];

function ageBand(base: number, step: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let age = 65; age <= 95; age += 5) {
    out[age] = Math.round((base + (age - 65) * step) * 100) / 100;
  }
  return out;
}

const NC_PROJECTION = CARRIERS_G.map((c, i) => ({
  n: c.company,
  c: PALETTE[i % PALETTE.length],
  ra: c.rateType,
  M: ageBand(c.rate, 6.4),
  F: ageBand(c.rate * 0.92, 5.9),
}));

const DRUGS: Record<string, Array<{ rxcui: string; name: string; strength: string; form: string }>> = {
  lisinopril: [{ rxcui: '314076', name: 'lisinopril', strength: '10 mg', form: 'oral tablet' }],
};

const PROVIDERS = [
  {
    npi: '1234567893',
    name: 'Sarah Chen',
    specialty: 'Internal Medicine',
    address: '3116 N Duke St, Durham, NC 27704',
  },
];

function json(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

export interface MockOptions {
  /**
   * Force /api/rates to fail, to exercise the "Could not load carrier rates"
   * path on the health screen. Off by default.
   */
  failRates?: boolean;
}

/**
 * Install every network stub this flow needs. Call before the first goto.
 * Returns a record of what the page actually requested, so a spec can assert
 * on request shape — notably that no PHI leaves the browser before /apply.
 */
export interface RequestLog {
  urls: string[];
  enrollBodies: unknown[];
  analyticsBodies: unknown[];
}

export async function installApiMocks(
  page: Page,
  persona: Persona,
  opts: MockOptions = {},
): Promise<RequestLog> {
  const log: RequestLog = { urls: [], enrollBodies: [], analyticsBodies: [] };
  const state = persona.state ?? 'NC';

  // ── Catch-all, registered FIRST on purpose ───────────────────────────────
  // Playwright checks route handlers in reverse registration order, so the
  // handler added first is the last one consulted. Everything specific below
  // therefore wins, and anything that reaches here is a request nobody
  // stubbed: it gets recorded as a finding and blocked, so the run can never
  // quietly depend on the network.
  await page.route(
    () => true,
    async (route) => {
      const url = route.request().url();
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
        return route.continue();
      }
      log.urls.push(`UNSTUBBED ${url}`);
      return route.abort('blockedbyclient');
    },
  );

  // ── Google Fonts ─────────────────────────────────────────────────────────
  // The app loads Fraunces / Inter / JetBrains Mono from Google. Served empty
  // so the run stays offline; font FAMILY never affects a disclosure check,
  // and font SIZE is computed from the stylesheet, which is bundled locally.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  );

  // ── Medigap rate bundle used by the scoring engine ───────────────────────
  await page.route('**/api/rates*', async (route) => {
    log.urls.push(route.request().url());
    if (opts.failRates) return json(route, { ok: false, error: 'Rate fetch failed' }, 500);
    // api/rates.ts reads pm_supp_carrier_rates_public — the 4,400-row CMS Plan
    // Finder scrape — and is NOT state-restricted. Every licensed state gets
    // carriers here. This mock returned an error for TX until 2026-09-19,
    // which was simply wrong: production serves a full TX results screen.
    return json(route, { ok: true, state, refZip: persona.zip, rates: { G: CARRIERS_G, N: CARRIERS_N } });
  });

  // ── Rate-projection widget ───────────────────────────────────────────────
  await page.route('**/api/medsup-rates*', async (route) => {
    log.urls.push(route.request().url());
    // A DIFFERENT table from /api/rates: pm_medsup_rate_public, the age-banded
    // set behind the projection chart. The handler's ALLOWED_STATES decides
    // whether a state gets a curve; outside it, 200 with available:false and
    // an EMPTY carrier list, so the widget takes its zero-carriers branch
    // ("Coming to <state> soon") rather than its error branch.
    //
    // This used to read `state !== 'NC'`, which meant every TX persona
    // exercised the empty branch no matter what the product did. That is the
    // failure the underwritten-tx persona was corrected for on 2026-09-19 —
    // a suite green because it agreed with an assumption. Keep this table in
    // step with ALLOWED_STATES in api/medsup-rates.ts.
    const PROJECTION: Record<string, typeof NC_PROJECTION | typeof TX_PROJECTION> = {
      NC: NC_PROJECTION,
      TX: TX_PROJECTION,
    };
    const carriers = PROJECTION[state];
    if (!carriers) {
      return json(route, {
        ok: true,
        state,
        available: false,
        message: `Supplement rates not yet loaded for ${state}. Contact your agent for a quote.`,
        carriers: [],
      });
    }
    return json(route, { ok: true, state, available: true, carriers });
  });

  // ── Shared library: drug search ──────────────────────────────────────────
  await page.route('**/api/library/drug-search*', async (route) => {
    log.urls.push(route.request().url());
    let q = '';
    try {
      q = String((route.request().postDataJSON() as { query?: string })?.query ?? '').toLowerCase();
    } catch {
      /* GET or empty body */
    }
    const key = Object.keys(DRUGS).find((k) => q.includes(k));
    return json(route, { ok: true, drugs: key ? DRUGS[key] : [] });
  });

  // ── Shared library: NPI search ───────────────────────────────────────────
  await page.route('**/api/library/npi-search*', async (route) => {
    log.urls.push(route.request().url());
    return json(route, { ok: true, providers: PROVIDERS, results: PROVIDERS });
  });

  // ── Application submission ───────────────────────────────────────────────
  await page.route('**/api/enroll*', async (route) => {
    log.urls.push(route.request().url());
    try {
      log.enrollBodies.push(route.request().postDataJSON());
    } catch {
      log.enrollBodies.push(route.request().postData());
    }
    return json(route, { ok: true, submissionId: 'test-submission-0001' });
  });

  // ── Analytics beacon (Supabase REST) ─────────────────────────────────────
  // Captured rather than dropped: a compliance run should be able to prove
  // the funnel beacon is not carrying PHI.
  await page.route('**/rest/v1/gh_analytics_events*', async (route) => {
    log.urls.push(route.request().url());
    try {
      log.analyticsBodies.push(route.request().postDataJSON());
    } catch {
      /* beacon with no parseable body */
    }
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });

  return log;
}
