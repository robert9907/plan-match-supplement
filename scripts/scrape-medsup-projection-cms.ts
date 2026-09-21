#!/usr/bin/env npx tsx
// ---------------------------------------------------------------------------
// scrape-medsup-projection-cms.ts — the age-banded Medigap scrape, from CMS.
//
//   npx tsx scripts/scrape-medsup-projection-cms.ts
//   npx tsx scripts/scrape-medsup-projection-cms.ts --states NC
//   npx tsx scripts/scrape-medsup-projection-cms.ts --out data/medsup-projection/cms-rates.csv
//
// This does NOT write to the database. It produces a CSV in the shape
// pm_medsup_rate holds, for seed-medsup-projection.mjs to load.
//
// Why this exists
// ---------------
// pm_medsup_rate — the curve behind the 20-year projection chart — was seeded
// from HealthSherpa. CMS is the source of truth and HealthSherpa is not, so
// every cell on that chart had the wrong provenance.
//
// The difference is not academic. Against CMS, on 2026-09-21:
//
//   AARP/UnitedHealthcare NC   HealthSherpa is +$2.00 at 65, 75, 85 and 95 —
//                              the same two dollars at every age. CMS files
//                              186.79; the chart showed 188.79.
//   Medico NC                  the stored curve is CMS's Medico Preferred
//                              multiplied by 0.81634 at every age. Not a quote
//                              and not a filed product — a scaled copy, ~18%
//                              under what Medico actually filed, sitting at the
//                              top of the cheapest-plan comparison.
//   Coverage                   CMS lists 37 Plan G policies in NC. HealthSherpa
//                              offers 12 carriers there. The chart showed 14.
//
// refresh-supp-carrier-rates.ts already said this job existed and was separate.
// It is separate because it writes a different table, at one ZIP per state
// rather than twelve, across seven ages rather than one.
//
// The contract, and why age works
// -------------------------------
//   GET /api/v1/data/plan-compare/medigap/policies
//       ?medigap_plan_type=MEDIGAP_PLAN_TYPE_G
//       &state=NC&zipcode=27713&age=72&gender=GENDER_MALE&tobacco=false
//
// The `age` parameter is honoured per year, not per five-year band, and it is
// a lookup against each carrier's own filing rather than a curve CMS applies.
// Verified 2026-09-21 on NC at 65/66/70/72/75: at 66, AARP and HealthSpring
// both hold their age-65 figure while Globe Life steps 168 -> 172. A formula
// would have moved all three together. Confirmed again on TX.
//
// One thing this scrape will faithfully reproduce, because it is CMS's own
// data: AARP NC is labelled COMMUNITY_RATED and its premium rises with age
// anyway — 186.79, 205.36 at 70, 223.93 at 72, 251.79 at 75, then flat from
// 85. That is not a HealthSherpa artifact and not ours. Do not "fix" it here.
// See scripts/check-rating-shape.mjs, which is deliberately not in the gate.
//
// Reference ZIP
// -------------
// pm_medsup_carrier is keyed by state, not ZIP, so the projection needs one
// representative ZIP per state and the choice belongs in the record rather
// than in someone's head. NC 27713 is Durham; TX 75201 is Dallas and is what
// the 2026-09-19 TX capture used; GA 30301 is Atlanta. Rates do vary by ZIP
// within a state for some carriers, so a curve is only claimed for that ZIP.
//
// Akamai handling is carried unchanged from refresh-supp-carrier-rates.ts.
// ---------------------------------------------------------------------------

import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** One representative ZIP per state. Stated here so it is reviewable. */
const REF_ZIP: Record<string, string> = { NC: '27713', TX: '75201', GA: '30301' };

const AGES = [65, 70, 75, 80, 85, 90, 95] as const;
const GENDERS = [['M', 'GENDER_MALE'], ['F', 'GENDER_FEMALE']] as const;
const PLAN = 'G';

const SPA_WARMUP_MS = 12_000;
const DELAY_MS = Number(process.env.MG_DELAY_MS ?? 3_500);
const BACKOFFS_MS = [30_000, 120_000, 300_000, 900_000];
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const argv = process.argv.slice(2);
const argOf = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const STATES = (argOf('--states') ?? 'NC,TX,GA').split(',').map((s) => s.trim().toUpperCase());
const OUT = argOf('--out') ?? 'data/medsup-projection/cms-rates.csv';
const PROGRESS = OUT + '.partial.json';

const HEADER = ['state','zip','plan_letter','carrier_name','rate_type','gender','age','monthly_premium'] as const;

class AkamaiBlocked extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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

async function fetchPolicies(page: Page, state: string, zip: string, age: number, gender: string) {
  const res = await page.evaluate(async (p) => {
    const url = `/api/v1/data/plan-compare/medigap/policies?medigap_plan_type=MEDIGAP_PLAN_TYPE_${p.plan}` +
      `&state=${p.state}&zipcode=${p.zip}&age=${p.age}&gender=${p.gender}&tobacco=false`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    return { status: r.status, text: text.slice(0, 2_000_000) };
  }, { state, zip, plan: PLAN, gender, age });

  if (res.status === 403 || /Access Denied/i.test(res.text)) throw new AkamaiBlocked(`${state}/${age}/${gender}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} on ${state}/${age}/${gender}`);

  const body = JSON.parse(res.text) as Record<string, unknown>;
  const key = Object.keys(body).find((k) => Array.isArray(body[k]));
  return (key ? body[key] : []) as Array<Record<string, unknown>>;
}

async function main(): Promise<void> {
  for (const st of STATES) {
    if (!REF_ZIP[st]) { console.error(`No reference ZIP recorded for ${st}. Add one to REF_ZIP.`); process.exit(1); }
  }

  const done: Record<string, string[][]> = existsSync(PROGRESS)
    ? JSON.parse(readFileSync(PROGRESS, 'utf8'))
    : {};

  const jobs: Array<{ state: string; zip: string; age: number; g: string; api: string }> = [];
  for (const state of STATES)
    for (const age of AGES)
      for (const [g, api] of GENDERS) jobs.push({ state, zip: REF_ZIP[state], age, g, api });

  const todo = jobs.filter((j) => !done[`${j.state}|${j.age}|${j.g}`]);
  console.log(`${jobs.length} queries (${STATES.length} states x ${AGES.length} ages x 2 genders), ${todo.length} to run.`);

  let { browser, page } = await bootstrap();
  let blocked = 0;

  for (let i = 0; i < todo.length; i++) {
    const j = todo[i];
    const key = `${j.state}|${j.age}|${j.g}`;
    try {
      const rows = await fetchPolicies(page, j.state, j.zip, j.age, j.api);
      done[key] = rows.map((r) => [
        j.state, j.zip, PLAN,
        String(r.company ?? ''), rateType(r.rate_type),
        j.g, String(j.age), String(r.monthly_rate_min ?? ''),
      ]);
      blocked = 0;
      mkdirSync(dirname(PROGRESS), { recursive: true });
      writeFileSync(PROGRESS, JSON.stringify(done));
      console.log(`  [${i + 1}/${todo.length}] ${key} — ${done[key].length} policies`);
      await sleep(DELAY_MS);
    } catch (err) {
      if (err instanceof AkamaiBlocked) {
        const wait = BACKOFFS_MS[Math.min(blocked, BACKOFFS_MS.length - 1)];
        blocked++;
        console.warn(`  blocked on ${key} — rotating, waiting ${wait / 1000}s (attempt ${blocked})`);
        await browser.close().catch(() => {});
        await sleep(wait);
        ({ browser, page } = await bootstrap());
        i--;
        continue;
      }
      throw err;
    }
  }
  await browser.close().catch(() => {});

  const all = Object.values(done).flat();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, [HEADER.join(','), ...all.map((r) => r.map(csvCell).join(','))].join('\n') + '\n');

  console.log(`\nWrote ${OUT} — ${all.length} rows.`);

  // A carrier missing an age is a gap in a curve, and a curve with a gap
  // cannot be totalled (hasCompleteCurveBetween). Name them here rather than
  // letting the chart silently drop the carrier.
  for (const st of STATES) {
    const rows = all.filter((r) => r[0] === st);
    const seen = new Map<string, Set<string>>();
    for (const r of rows) {
      const k = `${r[3]}|${r[5]}`;
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k)!.add(r[6]);
    }
    const ragged = [...seen.entries()].filter(([, ages]) => ages.size !== AGES.length);
    console.log(`  ${st}: ${rows.length} rows, ${seen.size} carrier/gender curves, ${ragged.length} incomplete`);
    for (const [k, ages] of ragged.slice(0, 10)) {
      const missing = AGES.filter((a) => !ages.has(String(a)));
      console.log(`      ${k} missing ${missing.join(',')}`);
    }
  }

  console.log('\nThis replaces the HealthSherpa-sourced curve. Before loading it, diff');
  console.log('it against what pm_medsup_rate holds — the differences are the point,');
  console.log('and they include at least one carrier (Medico NC) whose stored curve is');
  console.log('a scaled copy of a filed one rather than anything CMS ever published.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
