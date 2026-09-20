#!/usr/bin/env npx tsx
// ---------------------------------------------------------------------------
// refresh-supp-carrier-rates.ts — re-export the CMS Medigap rate table.
//
//   npx tsx scripts/refresh-supp-carrier-rates.ts
//   npx tsx scripts/refresh-supp-carrier-rates.ts --states NC
//   npx tsx scripts/refresh-supp-carrier-rates.ts --out ~/Downloads/medigap.csv
//
// Then, separately, load it:
//   node scripts/seed-carrier-rates.mjs data/medigap_G_N_all.csv
//
// This does NOT write to the database. It produces the CSV that
// seed-carrier-rates.mjs already consumes, so the household-premium guard
// added in c9645da still stands between a bad export and pm_supp_carrier_rates.
//
// Why this exists
// ---------------
// pm_supp_carrier_rates was last scraped 2026-06-12, by hand, and nobody
// could remember how. On 2026-09-20 a sample of 59 carriers across the three
// states found 17 of them stale — Humana Achieve NC by 30%, Mutual of Omaha
// TX by 25%, all three Medico NC series by 22.5%, BlueCross BlueShield of
// Texas by 19.9%, Atlantic Capital by 13%. That table drives /results, the
// main carrier list, so those were live understatements.
//
// It also cost real work downstream. Two "policy form" declarations were
// written into carrier-aliases.json to explain TX figures of 247.98 and
// 214.57 that did not match the filings. They match the filings exactly —
// the filings had simply moved. A stale reference table does not just show
// wrong numbers, it manufactures false explanations for correct ones.
//
// The contract
// ------------
//   GET /api/v1/data/plan-compare/medigap/policies
//       ?medigap_plan_type=MEDIGAP_PLAN_TYPE_G
//       &state=NC&zipcode=27713&age=65&gender=GENDER_MALE&tobacco=false
//
//   → { request_id, policies: [ { company, rate_type, monthly_rate_min,   <- key is `policies`
//        monthly_rate_max, address, phone_number, website,
//        monthly_rate_hhd_standard_min/max,
//        monthly_rate_hhd_roommate_min/max } ] }
//
// Those fields map onto pm_supp_carrier_rates one for one. Found by
// observation on 2026-09-20; see docs/medigap-scraper-spec.md.
//
// Age is fixed at 65 here because pm_supp_carrier_rates has no age column.
// The age-banded scrape that feeds pm_medsup_rate is a separate job against
// the same endpoint — see the spec.
//
// Akamai (carried from ~/Code/plan-match/scripts/scrape-medicare-gov.ts,
// all of it load-bearing)
// ---------------------------------------------------------------------
//   channel:'chrome'   bundled Chromium's TLS handshake is fingerprinted and
//                      its requests die with ERR_HTTP2_PROTOCOL_ERROR
//   real Chrome UA     same reason
//   12s warm-up        lets the sensor JS set _abck before the first call
//   fetch in-page      the cookie and TLS context have to match
//   403 / Access Denied → tear down, back off, rotate, retry
// ---------------------------------------------------------------------------

import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

// The twelve reference ZIPs per state already in pm_supp_carrier_rates:
//   select distinct state, zip from pm_supp_carrier_rates order by 1,2;
const ZIPS: Record<string, string[]> = {
  NC: ['27101','27401','27514','27601','27713','27858','28202','28401','28540','28655','28677','28801'],
  TX: ['73301','75201','75701','76101','76301','77001','77901','78201','78401','79101','79601','79901'],
  GA: ['30005','30060','30301','30501','30601','30701','30901','31061','31201','31401','31501','31601'],
};
const PLANS = ['G', 'N'] as const;
const GENDERS = [['MALE', 'GENDER_MALE'], ['FEMALE', 'GENDER_FEMALE']] as const;
const AGE = 65;

const SPA_WARMUP_MS = 12_000;
const DELAY_MS = Number(process.env.MG_DELAY_MS ?? 3_500);
const BACKOFFS_MS = [30_000, 120_000, 300_000, 900_000];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const STATES = (argOf('--states') ?? 'NC,TX,GA').split(',').map((s) => s.trim().toUpperCase());
const OUT = argOf('--out') ?? 'data/medigap_G_N_all.csv';
const PROGRESS = OUT + '.partial.json';

const HEADER = ['state','zip','plan','gender','company','rate_type','rate_min','rate_max',
  'hhd_std_min','hhd_std_max','hhd_rm_min','hhd_rm_max','phone','website','address'] as const;

class AkamaiBlocked extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * The API returns MEDIGAP_RATE_TYPE_ATTAINED_AGE; pm_supp_carrier_rates holds
 * ATTAINED_AGE, and seed-medsup-projection.mjs keys its RATING_TYPE map on the
 * bare form. Loading the prefixed value would put a null rating_type on every
 * projection carrier and a wrong rate-type disclosure on /results — which is a
 * NAIC Model Act §13 item, not cosmetic. Caught by checking one live response
 * against the table before trusting the mapping.
 */
const rateType = (v: unknown) => String(v ?? '').replace(/^MEDIGAP_RATE_TYPE_/, '');

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

async function bootstrap(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: process.env.MG_HEADFUL !== '1', channel: 'chrome' });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('https://www.medicare.gov/medigap-supplemental-insurance-plans/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SPA_WARMUP_MS);
  return { browser, page };
}

/** One query, fired from inside the page so cookies and TLS match. */
async function fetchPolicies(page: Page, state: string, zip: string, plan: string, gender: string) {
  const res = await page.evaluate(async (p) => {
    const url = `/api/v1/data/plan-compare/medigap/policies?medigap_plan_type=MEDIGAP_PLAN_TYPE_${p.plan}` +
      `&state=${p.state}&zipcode=${p.zip}&age=${p.age}&gender=${p.gender}&tobacco=false`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    return { status: r.status, text: text.slice(0, 2_000_000) };
  }, { state, zip, plan, gender, age: AGE });

  if (res.status === 403 || /Access Denied/i.test(res.text)) throw new AkamaiBlocked(`${state}/${zip}/${plan}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} on ${state}/${zip}/${plan}`);

  const body = JSON.parse(res.text) as Record<string, unknown>;
  const key = Object.keys(body).find((k) => Array.isArray(body[k]));
  return (key ? body[key] : []) as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  const done: Record<string, string[][]> = existsSync(PROGRESS)
    ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
    : {};
  const jobs: Array<{ state: string; zip: string; plan: string; g: string; api: string }> = [];
  for (const state of STATES)
    for (const zip of ZIPS[state] ?? [])
      for (const plan of PLANS)
        for (const [g, api] of GENDERS) jobs.push({ state, zip, plan, g, api });

  const todo = jobs.filter((j) => !done[`${j.state}|${j.zip}|${j.plan}|${j.g}`]);
  console.log(`${jobs.length} queries, ${jobs.length - todo.length} already captured, ${todo.length} to run.`);
  if (todo.length === 0) console.log('(resuming from a complete run — delete the .partial.json to force)');

  let { browser, page } = await bootstrap();
  let blocked = 0;

  for (let i = 0; i < todo.length; i++) {
    const j = todo[i];
    const key = `${j.state}|${j.zip}|${j.plan}|${j.g}`;
    try {
      const rows = await fetchPolicies(page, j.state, j.zip, j.plan, j.api);
      done[key] = rows.map((r) => [
        j.state, j.zip, j.plan, j.g,
        String(r.company ?? ''), rateType(r.rate_type),
        String(r.monthly_rate_min ?? ''), String(r.monthly_rate_max ?? ''),
        String(r.monthly_rate_hhd_standard_min ?? ''), String(r.monthly_rate_hhd_standard_max ?? ''),
        String(r.monthly_rate_hhd_roommate_min ?? ''), String(r.monthly_rate_hhd_roommate_max ?? ''),
        String(r.phone_number ?? ''), String(r.website ?? ''), String(r.address ?? ''),
      ]);
      blocked = 0;
      // Checkpoint every query — a 144-query run should never start over.
      mkdirSync(dirname(PROGRESS), { recursive: true });
      writeFileSync(PROGRESS, JSON.stringify(done));
      console.log(`  [${i + 1}/${todo.length}] ${key} — ${done[key].length} carriers`);
      await sleep(DELAY_MS);
    } catch (err) {
      if (err instanceof AkamaiBlocked) {
        const wait = BACKOFFS_MS[Math.min(blocked, BACKOFFS_MS.length - 1)];
        blocked++;
        console.warn(`  blocked on ${key} — rotating, waiting ${wait / 1000}s (attempt ${blocked})`);
        await browser.close().catch(() => {});
        await sleep(wait);
        ({ browser, page } = await bootstrap());
        i--; // retry this one
        continue;
      }
      throw err;
    }
  }
  await browser.close().catch(() => {});

  const all = Object.values(done).flat();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, [HEADER.join(','), ...all.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');

  const companies = new Set(all.map((r) => r[4]));
  console.log(`\nWrote ${OUT} — ${all.length} rows, ${companies.size} distinct companies.`);
  for (const st of STATES) {
    const n = all.filter((r) => r[0] === st).length;
    console.log(`  ${st}: ${n} rows`);
  }
  console.log(`\nNext: node scripts/seed-carrier-rates.mjs ${OUT}`);
  console.log('That has the household-premium guard. Read its output before trusting this.');
  console.log('');
  console.log('Expect it to stop on HealthSpring: medicare.gov still returns its');
  console.log('household figure at exactly 1.740x the standard rate, in every row.');
  console.log('That is the anomaly seed-carrier-rates.mjs was built to catch and it');
  console.log('has not been resolved — it is not a reason to pass --allow-hhd-anomalies');
  console.log('without deciding what that 1.740x actually means.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
