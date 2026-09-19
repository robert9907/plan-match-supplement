// scripts/_smoke-projection-stats.ts — smoke test
//
// Locks down the arithmetic behind the Plan G projection chart's four stat
// cards and its comparison table. These are rate representations on a
// consumer screen, so the property under test is narrow and absolute: a
// premium that was never filed must never surface as a number.
//
// The defect this exists to prevent
// ---------------------------------
// pm_medsup_rate is ragged. On 2026-09-19 North Carolina held 163 of the 196
// cells a complete set needs, and Aflac, AHIC and GPM each had seven male age
// bands and zero female rows. The widget totalled a carrier's 20-year cost by
// adding the bands that had a premium and skipping the ones that did not,
// then took the minimum across carriers. A carrier with no female rows summed
// to 0, and 0 wins every minimum — so a woman comparing carriers in NC was
// shown "Lowest 20yr total  $0" under a real carrier's name.
//
// `oldLowestTotal` below is that original implementation, kept so the test
// demonstrates the bug rather than merely asserting its absence. If someone
// reintroduces the skip-and-sum shortcut, the first assertion fails.
//
// Run: npx tsx scripts/_smoke-projection-stats.ts

import {
  PROJECTION_AGES,
  avgIncreasePct,
  cheapestAt,
  coverage,
  hasAnyRate,
  hasCompleteCurve,
  hasCompleteCurveBetween,
  lowestTotalBetween,
  totalBetween,
  pctChangeFromBase,
  rateAt,
  type Gender,
} from '../src/lib/projectionStats';
import type { MedsupCarrier } from '../src/lib/medsupRates';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

function carrier(
  n: string,
  M: Record<number, number>,
  F: Record<number, number>,
): MedsupCarrier {
  return { n, c: '#000', ra: 'attained_age', M, F };
}

/** A full 65→95 curve stepping up by `step` each band. */
function curve(base: number, step: number): Record<number, number> {
  const out: Record<number, number> = {};
  PROJECTION_AGES.forEach((a, i) => {
    out[a] = Number((base + step * i).toFixed(2));
  });
  return out;
}

// ── Fixtures ────────────────────────────────────────────────────────────
// Shaped after the real NC rows as of 2026-09-19: three carriers male-only,
// one partial, the rest complete.
const AFLAC = carrier('Aflac', curve(318.83, 30), {});
const AHIC = carrier('AHIC', curve(212.34, 20), {});
const GPM = carrier('GPM Health and Life Insurance Company', curve(179.69, 18), {});
// BCBSNC: female rows only at 65, 70 and 95 — a real gap in the middle.
const BCBSNC = carrier(
  'Blue Medicare Supplement (BCBSNC)',
  curve(205.5, 22),
  { 65: 179.5, 70: 196.0, 95: 402.0 },
);
const AETNA = carrier('Aetna Health Insurance Company', curve(208.25, 21), curve(181.01, 19));
const CIGNA = carrier('Cigna National Health Insurance Company', curve(171.92, 17), curve(149.5, 15));

const ALL = [AFLAC, AHIC, GPM, BCBSNC, AETNA, CIGNA];
const F: Gender = 'F';
const M: Gender = 'M';

// ── The original implementation, for contrast ───────────────────────────
function oldLowestTotal(carriers: MedsupCarrier[], gender: Gender) {
  let best: { n: string; t: number } = { n: '—', t: Infinity };
  for (const c of carriers) {
    let t = 0;
    for (let i = 0; i < PROJECTION_AGES.length - 1; i++) {
      const a = PROJECTION_AGES[i];
      const p = c[gender][a];
      if (p) {
        const span = PROJECTION_AGES[i + 1] - a;
        t += p * 12 * (span / 5);
      }
    }
    if (t < best.t) best = { n: c.n, t };
  }
  return isFinite(best.t) ? best : { n: '—', t: 0 };
}

console.log('\n1. The defect: skip-and-sum hands the win to a carrier with no data');
const legacy = oldLowestTotal(ALL, F);
check('old math totals a female-less carrier at $0', legacy.t, 0);
check('old math attributes that $0 to a named carrier', legacy.n, 'Aflac');

console.log('\n2. Lowest total over the window requires a complete curve in it');
const fixedF = lowestTotalBetween(ALL, F, 65, 85);
check('a carrier with no female rates cannot win', fixedF?.n, 'Cigna National Health Insurance Company');
check('BCBSNC is excluded on a partial female curve', fixedF?.n === 'Blue Medicare Supplement (BCBSNC)', false);
check(
  'no carrier with a complete curve means null, not $0',
  lowestTotalBetween([AFLAC, AHIC, GPM], F, 65, 85),
  null,
);

console.log('\n3. The window is a real 20 years, weighted by band width');
// Cigna female: 149.50, 164.50, 179.50, 194.50 across 65/70/75/80, each paid
// for the five years to the next band. 60 months x 688.00 = 41,280.
check('65 to 85 totals four bands at five years each', totalBetween(CIGNA, F, 65, 85), 41_280);
check(
  'the old six-bands-at-one-year math would have said 13,464',
  12 * (149.5 + 164.5 + 179.5 + 194.5 + 209.5 + 224.5),
  13_464,
);
check('the window moves with the applicant', totalBetween(CIGNA, F, 75, 95), 60 * (179.5 + 194.5 + 209.5 + 224.5));
check('a window with one band is not a total', totalBetween(CIGNA, F, 95, 95), null);
check(
  'window completeness is scoped, not whole-curve',
  hasCompleteCurveBetween(carrier('Partial', {}, { 65: 100, 70: 110, 75: 120 }), F, 65, 75),
  true,
);

console.log('\n4. Cheapest at an age band ignores absent premiums');
check('female age 65 picks the lowest filed rate', cheapestAt(ALL, F, 65)?.n, 'Cigna National Health Insurance Company');
check('female age 75 skips BCBSNC, which filed nothing there', cheapestAt(ALL, F, 75)?.n, 'Cigna National Health Insurance Company');
check('nothing filed at all yields null', cheapestAt([AFLAC, AHIC], F, 65), null);
check('male age 65 still resolves normally', cheapestAt(ALL, M, 65)?.n, 'Cigna National Health Insurance Company');

console.log('\n5. Percentage change is never measured against a dollar');
check(
  'BCBSNC female 65→75 is null, not a four-digit percentage',
  pctChangeFromBase(BCBSNC, F, 65, 75),
  null,
);
check(
  'a real pair still computes',
  pctChangeFromBase(AETNA, F, 65, 70),
  Math.round(((181.01 + 19 - 181.01) / 181.01) * 100),
);
check('base age equal to target yields null', pctChangeFromBase(AETNA, F, 65, 65), null);

console.log('\n6. Average increase distinguishes unknown from zero');
check('no usable pair yields null', avgIncreasePct([AFLAC], F, 65, 85), null);
check('a usable pair yields a number', typeof avgIncreasePct([AETNA, CIGNA], F, 65, 85), 'number');

console.log('\n7. Coverage is reported honestly');
const cov = coverage(ALL, F);
check('three carriers have no female rate on file', cov.missing.length, 3);
check('one carrier is partial', cov.partial, ['Blue Medicare Supplement (BCBSNC)']);
check('two carriers are complete', cov.complete.length, 2);
check('every male curve here is complete', coverage(ALL, M).complete.length, 6);

console.log('\n8. Primitives');
check('rateAt returns null for an unfiled band', rateAt(BCBSNC, F, 80), null);
check('rateAt returns the filed premium', rateAt(BCBSNC, F, 70), 196.0);
check('a zero premium is absent, not free', rateAt(carrier('Z', {}, { 65: 0 }), F, 65), null);
check('hasAnyRate is false for an empty gender map', hasAnyRate(AFLAC, F), false);
check('hasCompleteCurve is false on a partial curve', hasCompleteCurve(BCBSNC, F), false);
check('hasCompleteCurve is true on a full curve', hasCompleteCurve(AETNA, F), true);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} assertion(s)\n`);
  process.exit(1);
}
console.log('\nPASS: projection stats never turn an unfiled premium into a number\n');
