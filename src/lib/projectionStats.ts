// ---------------------------------------------------------------------------
// projectionStats.ts — the arithmetic behind the Plan G projection chart.
//
// This lives outside RateProjectionWidget.tsx for one reason: the numbers on
// those four stat cards are rate representations under NAIC Medigap Model Act
// §13, and rate arithmetic that only exists inside a React component cannot be
// unit-tested. scripts/_smoke-projection-stats.ts exercises every function
// here against the exact shape pm_medsup_rate produces, including the ragged
// shapes it produces today.
//
// The rule every function obeys: a premium that was never filed is never
// inferred. No interpolation, no carry-forward from the neighbouring age band,
// no substituting the other gender's figure. A missing rate produces null and
// the caller renders an em dash — it never produces a number.
//
// The defect this file was written to kill
// ----------------------------------------
// pm_medsup_rate is ragged. On 2026-09-19 NC held 163 of the 196 cells a
// complete set needs, and three carriers (Aflac, AHIC, GPM) had seven male
// ages and zero female rows. The widget summed a carrier's 20-year cost by
// iterating the age bands and adding only the ones that had a premium, then
// took the minimum across carriers. For a carrier with no female rows that sum
// is 0, and 0 wins every minimum — so a woman comparing carriers in North
// Carolina was shown "Lowest 20yr total  $0" attributed to a real, named
// carrier. A zero is not a cheap premium, it is an absent one, and the two
// must never collapse into the same value.
//
// Hence `hasCompleteCurveBetween`: a total is only quotable when every age
// band in the window has a filed premium. A partial sum understates the cost
// of the carrier that happens to be missing the most data, which inverts the
// ranking precisely for the carriers we know least about.
//
// The second defect
// -----------------
// The card labelled "Lowest 20yr total" ran `p * 12 * (span / 5)` over the
// bands from 65 to 90. Every band is five years wide, so `span / 5` is always
// 1 and each band contributed twelve months — six years of premium, presented
// as twenty, and always measured from 65 no matter how old the applicant was.
// A 65-year-old woman looking at Cigna saw $13,464 where the real 65→85 cost
// at those filed rates is $41,280. `totalBetween` weights each band by its
// actual width and runs the window the applicant is actually shown.
// ---------------------------------------------------------------------------

import type { MedsupCarrier } from './medsupRates';

export const PROJECTION_AGES = [65, 70, 75, 80, 85, 90, 95] as const;
export type AgeBand = (typeof PROJECTION_AGES)[number];
export type Gender = 'M' | 'F';

/** A filed premium: finite and above zero. Anything else is absent, not cheap. */
function filed(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** The premium this carrier filed for this gender at this age, or null. */
export function rateAt(
  carrier: MedsupCarrier,
  gender: Gender,
  age: number,
): number | null {
  const v = carrier[gender][age];
  return filed(v) ? v : null;
}

/** Every age band this carrier has a filed premium for, in ascending order. */
export function ratedAges(carrier: MedsupCarrier, gender: Gender): AgeBand[] {
  return PROJECTION_AGES.filter((a) => filed(carrier[gender][a]));
}

/** True when the carrier has at least one filed premium for this gender. */
export function hasAnyRate(carrier: MedsupCarrier, gender: Gender): boolean {
  return ratedAges(carrier, gender).length > 0;
}

/**
 * True only when every age band has a filed premium. This is the gate for any
 * statistic that spans the whole curve — see the header note on partial sums.
 */
export function hasCompleteCurve(carrier: MedsupCarrier, gender: Gender): boolean {
  return ratedAges(carrier, gender).length === PROJECTION_AGES.length;
}

/** The age bands the projection covers between two ages, inclusive. */
export function bandsBetween(fromAge: number, toAge: number): AgeBand[] {
  return PROJECTION_AGES.filter((a) => a >= fromAge && a <= toAge);
}

/**
 * True when every band in the window has a filed premium. Window-scoped
 * rather than whole-curve: a carrier missing only age 95 can still be ranked
 * honestly for a 65-year-old whose window ends at 85.
 */
export function hasCompleteCurveBetween(
  carrier: MedsupCarrier,
  gender: Gender,
  fromAge: number,
  toAge: number,
): boolean {
  const bands = bandsBetween(fromAge, toAge);
  return bands.length > 1 && bands.every((a) => rateAt(carrier, gender, a) !== null);
}

export interface Coverage {
  /** Carriers with a filed premium at every age band. */
  complete: string[];
  /** Carriers with some filed premiums but not all. */
  partial: string[];
  /** Carriers with no filed premium for this gender at all. */
  missing: string[];
}

/**
 * How much of the picture we actually have for this gender. The widget states
 * this on the screen: a chart drawn from 8 of 14 carriers must not be
 * presented as though it covered the market.
 */
export function coverage(carriers: MedsupCarrier[], gender: Gender): Coverage {
  const out: Coverage = { complete: [], partial: [], missing: [] };
  for (const c of carriers) {
    const n = ratedAges(c, gender).length;
    if (n === PROJECTION_AGES.length) out.complete.push(c.n);
    else if (n > 0) out.partial.push(c.n);
    else out.missing.push(c.n);
  }
  return out;
}

export interface CarrierAmount {
  n: string;
  p: number;
}

/**
 * Cheapest filed premium at one age band. Carriers with nothing filed at that
 * age are not candidates — they are unknown, not free.
 */
export function cheapestAt(
  carriers: MedsupCarrier[],
  gender: Gender,
  age: number,
): CarrierAmount | null {
  let best: CarrierAmount | null = null;
  for (const c of carriers) {
    const p = rateAt(c, gender, age);
    if (p !== null && (best === null || p < best.p)) best = { n: c.n, p };
  }
  return best;
}

export interface CarrierTotal {
  n: string;
  t: number;
}

/**
 * Lowest total cost across carriers over the window the screen is actually
 * showing (the applicant's current band through `toAge`), restricted to
 * carriers with a filed premium at every band in that window. Returns null
 * when no carrier qualifies, so the caller renders an em dash rather than a
 * figure it cannot stand behind.
 *
 * Each band is weighted by its real width in years: the premium at 65 is paid
 * for the five years to 70. The closing band carries no weight because the
 * window ends there.
 */
export function totalBetween(
  carrier: MedsupCarrier,
  gender: Gender,
  fromAge: number,
  toAge: number,
): number | null {
  if (!hasCompleteCurveBetween(carrier, gender, fromAge, toAge)) return null;
  const bands = bandsBetween(fromAge, toAge);
  let t = 0;
  for (let i = 0; i < bands.length - 1; i++) {
    const p = rateAt(carrier, gender, bands[i])!;
    t += p * 12 * (bands[i + 1] - bands[i]);
  }
  return t > 0 ? t : null;
}

export function lowestTotalBetween(
  carriers: MedsupCarrier[],
  gender: Gender,
  fromAge: number,
  toAge: number,
): CarrierTotal | null {
  let best: CarrierTotal | null = null;
  for (const c of carriers) {
    const t = totalBetween(c, gender, fromAge, toAge);
    if (t !== null && (best === null || t < best.t)) best = { n: c.n, t };
  }
  return best;
}

/**
 * Mean percentage increase between two age bands, over the carriers that filed
 * a premium at both. Returns null when no carrier did, rather than 0 — a 0%
 * increase and an unknown increase are different claims.
 */
export function avgIncreasePct(
  carriers: MedsupCarrier[],
  gender: Gender,
  fromAge: number,
  toAge: number,
): number | null {
  const usable = carriers.filter(
    (c) => rateAt(c, gender, fromAge) !== null && rateAt(c, gender, toAge) !== null,
  );
  if (usable.length === 0) return null;
  const sum = usable.reduce((acc, c) => {
    const p0 = rateAt(c, gender, fromAge)!;
    const p1 = rateAt(c, gender, toAge)!;
    return acc + ((p1 - p0) / p0) * 100;
  }, 0);
  return Math.round(sum / usable.length);
}

/**
 * Percentage change from the applicant's current age band to a later one.
 *
 * Returns null when either end is missing. The previous inline version used
 * `carrier[gender][age] || 1` as the base, so a carrier with no premium at the
 * current age produced a percentage measured against one dollar — a $206
 * premium at 75 rendered as "+20,500%".
 */
export function pctChangeFromBase(
  carrier: MedsupCarrier,
  gender: Gender,
  baseAge: number,
  age: number,
): number | null {
  if (age <= baseAge) return null;
  const p0 = rateAt(carrier, gender, baseAge);
  const p1 = rateAt(carrier, gender, age);
  if (p0 === null || p1 === null) return null;
  return Math.round(((p1 - p0) / p0) * 100);
}
