#!/usr/bin/env node
// ---------------------------------------------------------------------------
// _build-tx-rates-from-capture.mjs — derive the TX seed files from the
// HealthSherpa capture, so the derivation is reproducible instead of typed.
//
//   node scripts/_build-tx-rates-from-capture.mjs
//
// Reads  data/medsup-projection/tx-healthsherpa-planG.json  (158 quoted cells)
// Writes data/medsup-projection/tx-carriers.json
//        data/medsup-projection/tx-rates.csv
//
// Why this replaces what was there
// --------------------------------
// The previous tx-rates.csv held one age-65 figure per carrier and six blank
// bands, lifted from pm_supp_carrier_rates. That table has no age dimension —
// rate_min equals rate_max on every row, and the spread is across the state's
// twelve reference ZIPs — so it can anchor age 65 and nothing above it. A
// projection needs the curve, and the curve has to be quoted.
//
// It also held the seven carriers Rob is appointed with. That restriction is
// dropped: if an application comes in, the carrier can be written.
//
// Which CMS company anchors which quote
// -------------------------------------
// Matched by FIGURE at ZIP 75201, not by name — the same rule
// audit-medsup-provenance.mjs uses, and for the same reason. Measured deltas
// between the HealthSherpa age-65 quote and the CMS filing:
//
//   HealthSpring Insurance Company      exact, both genders
//   Aetna Health Insurance Company      exact, both genders
//   GPM Health and Life                 exact, both genders
//   AFLAC                               +$0.08 M / +$0.06 F   (+0.04%)
//   Humana (Emphesys)                   +$2.00 M / +$2.00 F   (flat fee)
//   BCBSTX "Plan G Select"              +$1.84 M / +$1.65 F   (+1.0%)
//   BCBSTX "Plan G"                     +19.9% M / +19.8% F   (second series)
//   Mutual of Omaha "MM25H"             +25.0% M / +25.0% F   (second series)
//
// The last two are policy forms CMS Plan Finder does not list separately: the
// scrape carries one figure per COMPANY, HealthSherpa quotes the FORM. Both
// are anchored to their company's CMS range, which is why each will warn at
// age 65 rather than pass silently. That warning is the truth, not noise.
//
// Two products are captured but not seeded, each for a stated reason — see
// `seed` and `note` in the emitted carriers file.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';

const CAPTURE = 'data/medsup-projection/tx-healthsherpa-planG.json';
const CARRIERS_OUT = 'data/medsup-projection/tx-carriers.json';
const RATES_OUT = 'data/medsup-projection/tx-rates.csv';
const FIXTURE_OUT = 'qa/fixtures/tx-projection.ts';

// capture plan_name -> what the chart calls it, and what anchors age 65.
// `cms` is the pm_supp_carrier_rates.company whose filed range is used for
// the age-65 cross-check; null means no company filed a figure near this
// quote, so there is nothing independent to check it against.
const MAP = {
  'Medicare Supplement Plan G Select': {
    name: 'BlueCross BlueShield of Texas (Plan G Select)',
    cms: 'BlueCross BlueShield of Texas',
    seed: true,
  },
  'Medicare Supplement Plan G': {
    name: 'BlueCross BlueShield of Texas (Plan G)',
    cms: 'BlueCross BlueShield of Texas',
    seed: true,
  },
  'Plan G from HealthSpring Insurance Company': {
    name: 'HealthSpring Insurance Company',
    cms: 'HealthSpring Insurance Company',
    seed: true,
  },
  'Plan G from HealthSpring National Health Insurance Company': {
    name: 'HealthSpring National Health Insurance Company',
    cms: null,
    seed: false,
    note:
      'No CMS company filed a figure near $233.35 M / $208.35 F at 75201. The ' +
      'obvious candidate, "HealthSpring Insurance Company (Standard II)", files ' +
      '$297.73 M / $258.90 F — 21.6% and 19.5% away, so it is a different series. ' +
      'Seeding this would put a curve on a consumer screen with nothing ' +
      'independent to check its age-65 anchor against, which is exactly how NC ' +
      'ended up showing three carriers the wrong premium. Flip to true only ' +
      'against a filing.',
  },
  'MED SUPP PLAN G 2010': {
    name: 'AFLAC',
    cms: 'AFLAC',
    seed: true,
  },
  'Humana Medicare Supplement Plan G': {
    name: 'Humana (Emphesys Insurance Company)',
    cms: 'Humana (Emphesys Insurance Company)',
    seed: true,
  },
  'Mutual of Omaha Insurance Company MM25H': {
    name: 'Mutual of Omaha (Mutual of Omaha Insurance Company)',
    cms: 'Mutual of Omaha (Mutual of Omaha Insurance Company)',
    seed: true,
  },
  'Aetna Health Insurance Company - Plan G': {
    name: 'Aetna Health Insurance Company',
    cms: 'Aetna Health Insurance Company',
    seed: true,
  },
  'GPM Health and Life Insurance Company MTM25': {
    name: 'GPM Health and Life Insurance Company',
    cms: 'GPM Health and Life Insurance Company',
    seed: true,
  },
  'AARP Medicare Supplement Plan G, Insured by UnitedHealthcare Insurance Company': {
    name: 'AARP - UnitedHealthcare Insurance Company (Standard)',
    cms: 'AARP - UnitedHealthcare Insurance Company (Standard)',
    seed: false,
    note:
      'Quotes at 65 and 70 and then drops out of the result set entirely — the ' +
      'product is not offered to this applicant from 75 on. It cannot carry a ' +
      '20-year curve, and two points on a seven-point chart is a gap, not a ' +
      'projection.',
  },
};

// The CMS filed range, phone and website for each anchor company, carried
// over from whatever tx-carriers.json currently holds. This script REWRITES
// that file, so it has to be able to read its own output: the first run reads
// the CMS-derived file (keyed by carrier_name), every run after that reads the
// file this script wrote (where the anchor is named by cms_company). Indexing
// on both makes it idempotent — a build script that only works once is not a
// record of how the data was made.
const PREVIOUS = JSON.parse(readFileSync(CARRIERS_OUT, 'utf8')).carriers;
const prevByName = new Map();
for (const c of PREVIOUS) {
  for (const key of [c.cms_company, c.carrier_name]) {
    if (!key) continue;
    // An entry that carries a filed range wins over one that does not, so a
    // re-run cannot quietly downgrade an anchor to null.
    const held = prevByName.get(key);
    if (!held || (held.cms_plan_g_low == null && c.cms_plan_g_low != null)) prevByName.set(key, c);
  }
}

const capture = JSON.parse(readFileSync(CAPTURE, 'utf8'));
const AGES = capture.ages;

const carriers = [];
const csv = ['carrier_name,gender,age,monthly_premium'];
const skipped = [];

for (const p of capture.plans) {
  if (p.suppressed) {
    skipped.push(`${p.plan_name} — migration-005 suppression list (${p.carrier})`);
    continue;
  }
  const m = MAP[p.plan_name];
  if (!m) throw new Error(`No mapping for capture plan "${p.plan_name}"`);

  const anchor = m.cms ? prevByName.get(m.cms) : null;
  if (m.cms && !anchor) throw new Error(`CMS anchor "${m.cms}" not in ${CARRIERS_OUT}`);

  carriers.push({
    carrier_name: m.name,
    rate_type: anchor?.rate_type ?? 'ATTAINED_AGE',
    phone: anchor?.phone ?? null,
    website: anchor?.website ?? null,
    cms_plan_g_low: anchor?.cms_plan_g_low ?? null,
    cms_plan_g_high: anchor?.cms_plan_g_high ?? null,
    cms_company: m.cms,
    source_plan_name: p.plan_name,
    seed: m.seed,
    ...(m.note ? { note: m.note } : {}),
    am_best: null,
    naic_code: null,
  });

  if (!m.seed) continue;
  for (const g of ['M', 'F']) {
    AGES.forEach((age, i) => {
      const v = p[g][i];
      csv.push(`"${m.name}",${g},${age},${v == null ? '' : v.toFixed(2)}`);
    });
  }
}

carriers.sort((a, b) => (a.cms_plan_g_low ?? 1e9) - (b.cms_plan_g_low ?? 1e9));

writeFileSync(
  CARRIERS_OUT,
  JSON.stringify(
    {
      state: capture._state,
      generated: new Date().toISOString(),
      source: capture._source,
      zip: capture._zip,
      derived_by: 'scripts/_build-tx-rates-from-capture.mjs',
      carriers,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(RATES_OUT, csv.join('\n') + '\n');

// The offline compliance harness mocks /api/medsup-rates. Until now it served
// an empty list for every state but NC, which meant the TX personas were
// testing the belief that TX has no data rather than testing the product —
// the same mistake the underwritten-tx persona was corrected for on
// 2026-09-19. Generating the fixture here keeps it tied to the CSV: the
// harness sees the real captured curve, AFLAC's 4.14x steepness included,
// not a synthetic straight line.
const PALETTE = ['#0d2f5e', '#1f6feb', '#2da44e', '#bf8700', '#8250df'];
const RATING_TYPE = { ATTAINED_AGE: 'attained_age', ISSUE_AGE: 'issue_age', COMMUNITY_RATED: 'community' };

const fixture = carriers
  .filter((c) => c.seed)
  .map((c, i) => {
    const p = capture.plans.find((x) => x.plan_name === c.source_plan_name);
    const band = (g) => Object.fromEntries(AGES.map((a, j) => [a, p[g][j]]).filter(([, v]) => v != null));
    return {
      n: c.carrier_name,
      c: PALETTE[i % PALETTE.length],
      ra: RATING_TYPE[String(c.rate_type).toUpperCase()] ?? 'attained_age',
      M: band('M'),
      F: band('F'),
    };
  });

writeFileSync(
  FIXTURE_OUT,
  '// GENERATED by scripts/_build-tx-rates-from-capture.mjs — do not edit by hand.\n' +
    '// The TX Plan G curve as /api/medsup-rates serves it, straight from the\n' +
    `// HealthSherpa capture of ${capture._zip} on ${capture._source.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? 'record'}.\n` +
    '// Regenerate rather than edit: a fixture that drifts from the seed data is a\n' +
    '// harness testing itself.\n\n' +
    'export const TX_PROJECTION = ' +
    JSON.stringify(fixture, null, 2) +
    ' as const;\n',
);

const seeded = carriers.filter((c) => c.seed);
console.log(`Wrote ${FIXTURE_OUT} — ${fixture.length} carrier(s) for the offline harness`);
console.log(`Wrote ${CARRIERS_OUT} — ${carriers.length} carrier(s), ${seeded.length} seed:true`);
console.log(`Wrote ${RATES_OUT} — ${csv.length - 1} cell(s)`);
for (const s of skipped) console.log(`  skipped: ${s}`);
for (const c of carriers.filter((x) => !x.seed)) console.log(`  seed:false ${c.carrier_name}`);
