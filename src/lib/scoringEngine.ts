// ─── Pseudo-underwriting scoring engine ──────────────────────────
//
// Every screening answer feeds into a scoring engine that simulates
// what a real Medigap underwriter would do: cross-reference meds
// against the carrier's DDL, look for knockout conditions, check the
// build chart, and — most importantly — evaluate COMBINATIONS. The
// consumer never sees "underwriting"; they just answer questions.
//
// Weights: Meds 40%, Health 30%, Build 15%, Tobacco 15%
// Overall score → rate class → low/high premium range per carrier.

import { DDL, ddlLookup, type DdlCluster, type DdlEntry } from './ddlData';
import { classifyBuild, CLASS_I_MAX, CLASS_II_MAX, STANDARD_MAX } from './buildChart';

// ─── Inputs ──────────────────────────────────────────────────────

export interface MedItem {
  name: string;
  dose: string;
  ddl?: DdlEntry;
  status: 'safe' | 'warn' | 'flag';
  statusText: string;
}

export type YesNo = 'y' | 'n' | null;

export interface HealthAnswers {
  // Knockout questions
  q1_hospitalized: YesNo;
  q2_hospice: YesNo;
  q3_dialysis: YesNo;
  q4_cancer: YesNo;
  q5_transplant: YesNo;
  q6_als_hiv_hepc: YesNo;
  q7_diabetes: YesNo;
  q8_heart: YesNo;
  q9_copd: YesNo;
  q10_neuro: YesNo;
  q11_mental: YesNo;
  q12_pending: YesNo;
  // Conditional sliders
  diabetesMgmt: 'diet' | 'oral' | 'u50' | 'o50' | null;
  heartRecency: 'o2' | 'u2' | 'now' | null;
}

export function emptyHealthAnswers(): HealthAnswers {
  return {
    q1_hospitalized: null,
    q2_hospice: null,
    q3_dialysis: null,
    q4_cancer: null,
    q5_transplant: null,
    q6_als_hiv_hepc: null,
    q7_diabetes: null,
    q8_heart: null,
    q9_copd: null,
    q10_neuro: null,
    q11_mental: null,
    q12_pending: null,
    diabetesMgmt: null,
    heartRecency: null,
  };
}

export interface ScoringInputs {
  age: number;
  gender: 'Male' | 'Female';
  tobacco: 'Yes' | 'No';
  meds: MedItem[];
  health: HealthAnswers;
  heightIn: number | null;
  weightLbs: number | null;
  /** If true, OEP bypass — every carrier at 100%, preferred rate class. */
  oep?: boolean;
}

// ─── Outputs ─────────────────────────────────────────────────────

export type ScoreTone = 'high' | 'mid' | 'low';

export interface RateClass {
  name: string;
  lo: number;
  hi: number;
  badge: 'preferred' | 'standard' | 'rated' | 'high-rated';
}

export interface CarrierResult {
  name: string;
  score: number;
  tone: ScoreTone;
  rateClass: RateClass;
  planGLo: number;
  planGHi: number;
  planNLo: number;
  planNHi: number;
  reason: string;
  discount: string;
  ctaLabel: string;
}

export interface ScoringResult {
  overall: number;
  overallTone: ScoreTone;
  verdict: string;
  factorMeds: number;
  factorHealth: number;
  factorBuild: number;
  factorTobacco: number;
  comboFlags: string[];
  clusters: Record<DdlCluster, number>;
  clusterDrugs: Record<DdlCluster, string[]>;
  carriers: CarrierResult[];
  buildClassLabel: string;
  flagCount: number;
  healthFlagCount: number;
  isOep: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────

function toneForScore(score: number): ScoreTone {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

function verdictForScore(s: number): string {
  if (s >= 85) return 'Strong qualification profile';
  if (s >= 70) return 'Good — most carriers likely accept';
  if (s >= 50) return 'Mixed — some carriers may accept';
  if (s >= 25) return 'Limited options — Rob can help';
  return 'Most carriers will decline';
}

function rateClassForScore(s: number): RateClass {
  if (s >= 85) return { name: 'Preferred', lo: 0.85, hi: 0.95, badge: 'preferred' };
  if (s >= 70) return { name: 'Standard', lo: 0.95, hi: 1.05, badge: 'standard' };
  if (s >= 55) return { name: 'Standard I', lo: 1.05, hi: 1.15, badge: 'rated' };
  if (s >= 40) return { name: 'Standard II', lo: 1.15, hi: 1.25, badge: 'rated' };
  if (s >= 25) return { name: 'Standard III', lo: 1.25, hi: 1.4, badge: 'high-rated' };
  return { name: 'Likely Decline', lo: 0, hi: 0, badge: 'high-rated' };
}

// Base monthly premium for Plan G/N at age 65, female, non-tobacco, NC avg.
const BASE_PLAN_G = 135;
const BASE_PLAN_N = 95;

function baseRate(plan: 'G' | 'N', age: number, gender: 'Male' | 'Female', tobacco: 'Yes' | 'No'): number {
  let base = plan === 'G' ? BASE_PLAN_G : BASE_PLAN_N;
  // +3.5% per year over 65 (cannot go below 65 baseline)
  const effAge = Math.max(65, age);
  base *= 1 + (effAge - 65) * 0.035;
  if (gender === 'Male') base *= 1.18;
  if (tobacco === 'Yes') base *= 1.2;
  return base;
}

interface CarrierDef {
  name: string;
  /** Price adjustment factor for Plan G (multiplied against base rate). */
  gA: number;
  /** Price adjustment factor for Plan N. */
  nA: number;
  /** Household discount copy. */
  discount: string;
}

const CARRIERS: CarrierDef[] = [
  { name: 'BCBS of NC', gA: 1.05, nA: 1.05, discount: '10% household' },
  { name: 'Mutual of Omaha', gA: 1.02, nA: 0.99, discount: '12% household' },
  { name: 'Aetna', gA: 1.07, nA: 1.06, discount: '7% household' },
  { name: 'Cigna', gA: 1.1, nA: 1.11, discount: '20% household' },
  { name: 'Bankers Fidelity', gA: 1.01, nA: 0.97, discount: 'None' },
  { name: 'Humana', gA: 1.12, nA: 1.13, discount: '5% household' },
];

function emptyClusters(): Record<DdlCluster, number> {
  return {
    diabetes: 0,
    cardio: 0,
    respiratory: 0,
    mental: 0,
    pain: 0,
    neuro: 0,
    cancer: 0,
    autoimmune: 0,
    renal: 0,
    transplant: 0,
  };
}

function emptyClusterDrugs(): Record<DdlCluster, string[]> {
  return {
    diabetes: [],
    cardio: [],
    respiratory: [],
    mental: [],
    pain: [],
    neuro: [],
    cancer: [],
    autoimmune: [],
    renal: [],
    transplant: [],
  };
}

// ─── Score components ────────────────────────────────────────────

function scoreHealth(h: HealthAnswers): number {
  // Any of these as "yes" is an underwriting knockout — score = 0.
  const knockouts: YesNo[] = [
    h.q1_hospitalized,
    h.q2_hospice,
    h.q3_dialysis,
    h.q4_cancer,
    h.q5_transplant,
    h.q6_als_hiv_hepc,
    h.q10_neuro,
    h.q11_mental,
    h.q12_pending,
  ];
  if (knockouts.some((a) => a === 'y')) return 0;

  let score = 100;
  if (h.q7_diabetes === 'y') {
    if (h.diabetesMgmt === 'o50') score = Math.min(score, 15);
    else if (h.diabetesMgmt === 'u50') score = Math.min(score, 65);
    else if (h.diabetesMgmt === 'oral') score = Math.min(score, 80);
    else score = Math.min(score, 90); // diet
  }
  if (h.q8_heart === 'y') {
    if (h.heartRecency === 'now') score = Math.min(score, 5);
    else if (h.heartRecency === 'u2') score = Math.min(score, 10);
    else score = Math.min(score, 55); // 2+ years
  }
  if (h.q9_copd === 'y') score = Math.min(score, 50);
  return score;
}

interface MedsScore {
  score: number;
  flagCount: number;
  warnCount: number;
  clusters: Record<DdlCluster, number>;
  clusterDrugs: Record<DdlCluster, string[]>;
  comboFlags: string[];
}

function scoreMeds(meds: MedItem[]): MedsScore {
  let score = 100;
  const flagCount = meds.filter((m) => m.status === 'flag').length;
  const warnCount = meds.filter((m) => m.status === 'warn').length;
  if (flagCount > 0) score = Math.max(5, 100 - flagCount * 40);
  if (warnCount > 0) score = Math.min(score, 100 - warnCount * 15);

  const clusters = emptyClusters();
  const clusterDrugs = emptyClusterDrugs();
  meds.forEach((m) => {
    const d = ddlLookup(m.name);
    if (d?.cluster) {
      clusters[d.cluster]++;
      clusterDrugs[d.cluster].push(m.name);
    }
  });

  const comboFlags: string[] = [];

  // Diabetes med stacking
  if (clusters.diabetes >= 3) {
    score -= 15;
    comboFlags.push(`${clusters.diabetes} diabetes meds — carriers flag 3+.`);
  } else if (clusters.diabetes === 2) {
    score -= 5;
  }

  // Cardio med stacking
  if (clusters.cardio >= 4) {
    score -= 15;
    comboFlags.push(`${clusters.cardio} cardiovascular meds — signals active heart disease.`);
  } else if (clusters.cardio === 3) {
    score -= 5;
  }

  // The killer combination
  if (clusters.diabetes >= 2 && clusters.cardio >= 2) {
    score -= 25;
    comboFlags.push(
      `Diabetes (${clusters.diabetes}) + cardiovascular (${clusters.cardio}) combo — most carriers flag or decline.`,
    );
  } else if (clusters.diabetes >= 1 && clusters.cardio >= 2) {
    score -= 10;
    comboFlags.push(`Diabetes + ${clusters.cardio} cardio meds — closer review.`);
  }

  // Polypharmacy
  if (meds.length >= 8) {
    score -= 10;
    comboFlags.push(`${meds.length} total meds — polypharmacy flag.`);
  }

  // Respiratory stacking
  if (clusters.respiratory >= 2) {
    score -= 10;
    comboFlags.push(`${clusters.respiratory} respiratory meds.`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    flagCount,
    warnCount,
    clusters,
    clusterDrugs,
    comboFlags,
  };
}

function scoreBuild(heightIn: number | null, weightLbs: number | null): number {
  if (!heightIn || !weightLbs) return 100;
  const cls = classifyBuild(heightIn, weightLbs);
  switch (cls) {
    case 'standard':
      return 100;
    case 'class1':
      return 75;
    case 'class2':
      return 55;
    case 'decline':
      return 10;
    default:
      return 100;
  }
}

function scoreTobacco(tobacco: 'Yes' | 'No'): number {
  return tobacco === 'Yes' ? 85 : 100;
}

function buildClassLabelFor(heightIn: number | null, weightLbs: number | null): string {
  if (!heightIn || !weightLbs) return 'Not provided';
  const cls = classifyBuild(heightIn, weightLbs);
  switch (cls) {
    case 'standard':
      return 'Standard';
    case 'class1':
      return 'Class I (+10%)';
    case 'class2':
      return 'Class II (+20%)';
    case 'decline':
      return 'Above max — likely decline';
    default:
      return 'Not provided';
  }
}

// ─── Per-carrier adjustment ──────────────────────────────────────
//
// Each carrier has documented tolerance quirks. After the overall score
// is known, bump each carrier up or down to reflect their underwriting
// personality.

function adjustCarrierScore(
  carrierName: string,
  overall: number,
  meds: MedItem[],
  clusters: Record<DdlCluster, number>,
  health: HealthAnswers,
): number {
  let s = overall;

  // Bankers Fidelity — the lenient carrier. Accepts insulin 50+ when
  // others decline. More tolerant of diabetes+cardio combos.
  if (carrierName === 'Bankers Fidelity') {
    if (health.diabetesMgmt === 'o50') s = Math.max(s, 72);
    if (health.q7_diabetes === 'y' && health.diabetesMgmt !== 'o50') s += 10;
    if (clusters.diabetes >= 2 && clusters.cardio >= 2) s += 15;
  }

  // Cigna accepts COPD at Std II/III when others decline.
  if (carrierName === 'Cigna' && (health.q9_copd === 'y' || clusters.respiratory >= 1)) {
    s += 15;
  }

  // Aetna is stricter on diabetes+cardio combos.
  if (carrierName === 'Aetna' && clusters.diabetes >= 2 && clusters.cardio >= 2) {
    s -= 10;
  }

  // Mutual of Omaha — stricter on 3+ diabetes meds.
  if (carrierName === 'Mutual of Omaha' && clusters.diabetes >= 3) {
    s -= 10;
  }

  // Humana — moderate penalty on 3+ diabetes meds.
  if (carrierName === 'Humana' && clusters.diabetes >= 3) {
    s -= 5;
  }

  // Drug-specific carrier exceptions — if a med explicitly notes a
  // carrier exception (e.g. Cigna for COPD drugs), bump that carrier.
  meds.forEach((m) => {
    const d = ddlLookup(m.name);
    if (d?.carrierException === carrierName) {
      s = Math.max(s, 45);
    }
  });

  return Math.max(0, Math.min(100, Math.round(s)));
}

function reasonForCarrier(carrierName: string, score: number, rc: RateClass): string {
  if (score >= 85) {
    return `${score}% — strong. Predicted: ${rc.name}. Final rate set by ${carrierName} after underwriting.`;
  }
  if (score >= 70) {
    return `${score}% — likely accepted at ${rc.name}. Final rate set by ${carrierName}.`;
  }
  if (score >= 55) {
    return `${score}% — may accept at ${rc.name}. Rob verifies before applying.`;
  }
  if (score >= 40) {
    return `${score}% — possible at ${rc.name}. Rob pre-screens with ${carrierName}.`;
  }
  if (score >= 25) {
    return `${score}% — limited. ${rc.name} if accepted. Rob can check.`;
  }
  return 'Low likelihood. Rob can verify or suggest alternatives.';
}

function ctaLabel(score: number): string {
  if (score >= 70) return 'Apply with Rob →';
  if (score >= 40) return 'Talk to Rob first →';
  return 'Call Rob to discuss';
}

// ─── Public entry point ──────────────────────────────────────────

export function scoreApplication(inputs: ScoringInputs): ScoringResult {
  // OEP bypass — "Turning 65" consumers are in their Open Enrollment
  // Period. Every carrier must accept them at preferred rates with no
  // underwriting. We still render carrier cards but at 100% each.
  if (inputs.oep) {
    const rc: RateClass = { name: 'Preferred', lo: 0.85, hi: 0.95, badge: 'preferred' };
    const gRate = baseRate('G', inputs.age, inputs.gender, inputs.tobacco);
    const nRate = baseRate('N', inputs.age, inputs.gender, inputs.tobacco);
    const carriers: CarrierResult[] = CARRIERS.map((c) => ({
      name: c.name,
      score: 100,
      tone: 'high' as const,
      rateClass: rc,
      planGLo: Math.round(gRate * c.gA * rc.lo),
      planGHi: Math.round(gRate * c.gA * rc.hi),
      planNLo: Math.round(nRate * c.nA * rc.lo),
      planNHi: Math.round(nRate * c.nA * rc.hi),
      reason: `100% — guaranteed acceptance at ${rc.name} rates. OEP — no health screening required.`,
      discount: c.discount,
      ctaLabel: 'Apply with Rob →',
    }));
    return {
      overall: 100,
      overallTone: 'high',
      verdict: 'Guaranteed acceptance',
      factorMeds: 100,
      factorHealth: 100,
      factorBuild: 100,
      factorTobacco: 100,
      comboFlags: [],
      clusters: emptyClusters(),
      clusterDrugs: emptyClusterDrugs(),
      carriers,
      buildClassLabel: 'Not required (OEP)',
      flagCount: 0,
      healthFlagCount: 0,
      isOep: true,
    };
  }

  const healthScore = scoreHealth(inputs.health);
  const medsResult = scoreMeds(inputs.meds);
  const buildScoreValue = scoreBuild(inputs.heightIn, inputs.weightLbs);
  const tobaccoScore = scoreTobacco(inputs.tobacco);

  const overall = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        medsResult.score * 0.4 +
          healthScore * 0.3 +
          buildScoreValue * 0.15 +
          tobaccoScore * 0.15,
      ),
    ),
  );

  const healthFlagCount = [
    inputs.health.q1_hospitalized,
    inputs.health.q2_hospice,
    inputs.health.q3_dialysis,
    inputs.health.q4_cancer,
    inputs.health.q5_transplant,
    inputs.health.q6_als_hiv_hepc,
    inputs.health.q7_diabetes,
    inputs.health.q8_heart,
    inputs.health.q9_copd,
    inputs.health.q10_neuro,
    inputs.health.q11_mental,
    inputs.health.q12_pending,
  ].filter((a) => a === 'y').length;

  const gRate = baseRate('G', inputs.age, inputs.gender, inputs.tobacco);
  const nRate = baseRate('N', inputs.age, inputs.gender, inputs.tobacco);

  const carriers: CarrierResult[] = CARRIERS.map((c) => {
    const score = adjustCarrierScore(
      c.name,
      overall,
      inputs.meds,
      medsResult.clusters,
      inputs.health,
    );
    const tone = toneForScore(score);
    const rc = rateClassForScore(score);
    return {
      name: c.name,
      score,
      tone,
      rateClass: rc,
      planGLo: rc.lo > 0 ? Math.round(gRate * c.gA * rc.lo) : 0,
      planGHi: rc.hi > 0 ? Math.round(gRate * c.gA * rc.hi) : 0,
      planNLo: rc.lo > 0 ? Math.round(nRate * c.nA * rc.lo) : 0,
      planNHi: rc.hi > 0 ? Math.round(nRate * c.nA * rc.hi) : 0,
      reason: reasonForCarrier(c.name, score, rc),
      discount: c.discount,
      ctaLabel: ctaLabel(score),
    };
  }).sort((a, b) => b.score - a.score);

  return {
    overall,
    overallTone: toneForScore(overall),
    verdict: verdictForScore(overall),
    factorMeds: medsResult.score,
    factorHealth: healthScore,
    factorBuild: buildScoreValue,
    factorTobacco: tobaccoScore,
    comboFlags: medsResult.comboFlags,
    clusters: medsResult.clusters,
    clusterDrugs: medsResult.clusterDrugs,
    carriers,
    buildClassLabel: buildClassLabelFor(inputs.heightIn, inputs.weightLbs),
    flagCount: medsResult.flagCount,
    healthFlagCount,
    isOep: false,
  };
}

// ─── Used by Meds screen to classify a drug as it's added ────────

export function classifyMed(name: string): Pick<MedItem, 'status' | 'statusText' | 'ddl'> {
  const ddl = ddlLookup(name);
  if (ddl && ddl.condition) {
    if (ddl.declineAll) {
      return { status: 'flag', statusText: `DDL: ${ddl.condition}`, ddl };
    }
    return { status: 'warn', statusText: ddl.note ?? ddl.condition, ddl };
  }
  return { status: 'safe', statusText: 'No DDL flag', ddl };
}

// Re-export for screens that want cluster typing.
export type { DdlCluster };

// The build chart ranges for display (currently unused externally but
// kept here so we could surface "X lbs away from Class I" copy later).
export const BUILD_TABLES = { STANDARD_MAX, CLASS_I_MAX, CLASS_II_MAX };
export { DDL };
