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
  /** When true, the carrier won't write this applicant at any rate class.
   * UI renders no percentage, no bar — just the reason. */
  hardKnockout?: boolean;
  knockoutReason?: string;
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
    anticoagulant: 0,
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
    anticoagulant: [],
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

function scoreMeds(meds: MedItem[], health: HealthAnswers): MedsScore {
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

  const insulinMeds = meds.filter((m) => ddlLookup(m.name)?.isInsulin);
  const hasInsulin = insulinMeds.length > 0;
  // "Cardiac signal" = any evidence of cardiovascular burden — raw cardio
  // meds, an anticoagulant (AFib/stent/DVT proxy), or an explicit heart
  // answer on the health screen.
  const cardiacSignal =
    clusters.cardio >= 1 || clusters.anticoagulant >= 1 || health.q8_heart === 'y';

  const comboFlags: string[] = [];

  // Diabetes med stacking — industry line is 3+, MoO's 2×2 Rule declines
  // >2 oral diabetes meds outright.
  if (clusters.diabetes >= 3) {
    score = Math.min(score, 25);
    comboFlags.push(
      `${clusters.diabetes} diabetes meds — most carriers flag 3+ as a decline threshold.`,
    );
  } else if (clusters.diabetes === 2) {
    score -= 10;
  }

  // Cardio med stacking (BP / statin / beta blocker — excluding anticoagulants).
  if (clusters.cardio >= 4) {
    score = Math.min(score, 25);
    comboFlags.push(`${clusters.cardio} cardiovascular meds — signals active heart disease.`);
  } else if (clusters.cardio >= 3) {
    score -= 15;
    comboFlags.push(`${clusters.cardio} cardio meds — MoO 2×2 decline threshold.`);
  }

  // Anticoagulant presence — Warfarin / Eliquis / Xarelto / Pradaxa / Plavix.
  // Read by underwriters as a proxy for AFib, post-stent, DVT, mechanical
  // valve, or recent stroke/TIA. Carries more weight than routine BP meds.
  if (clusters.anticoagulant >= 1) {
    score -= 15;
    comboFlags.push(
      `Anticoagulant (${clusterDrugs.anticoagulant.join(', ')}) — carriers read as proxy for AFib / post-stent / DVT.`,
    );
  }

  // Diabetes + cardiac combo — with anticoagulant or cardio cluster, this
  // is the MoO/Humana/Aetna/Cigna-Preferred Part A knockout combo.
  if (clusters.diabetes >= 1 && (clusters.cardio >= 2 || clusters.anticoagulant >= 1)) {
    score = Math.min(score, 20);
    comboFlags.push(
      `Diabetes + cardiac combo — Part A knockout at most carriers (Cigna Std II/III or Bankers may accept).`,
    );
  } else if (clusters.diabetes >= 1 && clusters.cardio >= 1) {
    score -= 15;
    comboFlags.push(`Diabetes + cardio — closer review.`);
  }

  // Insulin + any cardiac signal — hard cap. Matches the compound question:
  // "diabetes (insulin dependent or oral) with heart/stroke/BP 3+/insulin 50+".
  if (hasInsulin && cardiacSignal) {
    score = Math.min(score, 15);
    comboFlags.push(
      `Insulin (${insulinMeds.map((m) => m.name).join(', ')}) + cardiac signal — Part A knockout at most carriers.`,
    );
  }

  // Insulin alone with high daily units — same compound question trigger.
  if (hasInsulin && health.diabetesMgmt === 'o50') {
    score = Math.min(score, 20);
  }

  // Polypharmacy — brokers flag 5+ maintenance Rx as closer review.
  if (meds.length >= 8) {
    score -= 15;
    comboFlags.push(`${meds.length} total meds — polypharmacy flag.`);
  } else if (meds.length >= 5) {
    score -= 5;
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

/** Carriers that do NOT offer rated classes in NC — it's accept at
 * Preferred/Standard or decline. Drives both the binary knockout check
 * and the rate-class selection. */
const BINARY_NC_CARRIERS = new Set(['Mutual of Omaha', 'Humana']);

function adjustCarrierScore(
  carrierName: string,
  overall: number,
  meds: MedItem[],
  clusters: Record<DdlCluster, number>,
  health: HealthAnswers,
): number {
  let s = overall;

  const cardiacSignal =
    clusters.cardio >= 1 || clusters.anticoagulant >= 1 || health.q8_heart === 'y';
  const hasInsulin = meds.some((m) => ddlLookup(m.name)?.isInsulin);

  // Bankers Fidelity — the softest carrier in the panel. Documented to
  // accept >50 u/day insulin and heavier diabetes profiles where others
  // decline. Give it a distinctly higher floor on those profiles so the
  // differentiation shows up on the Results screen.
  if (carrierName === 'Bankers Fidelity') {
    if (hasInsulin || health.diabetesMgmt === 'o50') s = Math.max(s, 55);
    if (clusters.diabetes >= 3) s = Math.max(s, 50);
    if (health.q7_diabetes === 'y' && health.diabetesMgmt !== 'o50') s += 10;
    if (clusters.diabetes >= 1 && cardiacSignal) s = Math.max(s, 45);
  }

  // Cigna has filed Std II/Std III tiers — accepts profiles at rated class
  // that MoO/Humana decline outright.
  if (carrierName === 'Cigna') {
    if (health.q9_copd === 'y' || clusters.respiratory >= 1) s += 15;
    if (clusters.diabetes >= 1 && cardiacSignal) s = Math.max(s, 45);
  }

  // Aetna is stricter than peers on diabetes + cardiovascular combos.
  if (carrierName === 'Aetna' && clusters.diabetes >= 1 && cardiacSignal) {
    s -= 20;
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

/** Detects knockouts that apply to every carrier regardless of personality:
 * active cancer, transplant, dialysis, hospice, ALS/HIV/HepC, recent
 * hospitalization, pending procedures, severe mental/neurodegenerative
 * dx, or any med on the universal DDL (Humira, Gleevec, OxyContin, etc.). */
function universalKnockoutReason(meds: MedItem[], health: HealthAnswers): string | null {
  if (health.q1_hospitalized === 'y') return 'Hospitalized in past 12 months';
  if (health.q2_hospice === 'y') return 'Hospice care';
  if (health.q3_dialysis === 'y') return 'Dialysis';
  if (health.q4_cancer === 'y') return 'Active cancer treatment';
  if (health.q5_transplant === 'y') return 'Organ transplant history';
  if (health.q6_als_hiv_hepc === 'y') return 'ALS / HIV / Hepatitis C';
  if (health.q10_neuro === 'y') return 'Neurodegenerative condition';
  if (health.q11_mental === 'y') return 'Severe mental health condition';
  if (health.q12_pending === 'y') return 'Pending procedure or hospitalization';
  const declineMed = meds.find((m) => ddlLookup(m.name)?.declineAll);
  if (declineMed) {
    const cond = ddlLookup(declineMed.name)?.condition ?? 'universal DDL';
    return `${declineMed.name} — ${cond}`;
  }
  return null;
}

/** Carrier-specific knockouts beyond the universal list. Returns a reason
 * string when the carrier will decline, or null to fall through to the
 * adjusted-score path. */
function carrierKnockoutReason(
  carrierName: string,
  adjustedScore: number,
  clusters: Record<DdlCluster, number>,
  health: HealthAnswers,
): string | null {
  // Mutual of Omaha — NC prohibits rate-ups, so this is binary. The 2×2
  // Rule declines >2 diabetes meds, >2 BP meds, or diabetes combined with
  // an explicit heart condition, an anticoagulant (heart-dx proxy), or
  // 3+ BP meds (the "hypertension counts as heart condition" line).
  if (carrierName === 'Mutual of Omaha') {
    if (clusters.diabetes > 2) return '>2 diabetes meds — MoO 2×2 Rule decline';
    if (clusters.cardio > 2) return '>2 cardio meds — MoO 2×2 Rule decline';
    if (
      clusters.diabetes >= 1 &&
      (health.q8_heart === 'y' || clusters.anticoagulant >= 1 || clusters.cardio >= 3)
    ) {
      return 'Diabetes + cardiac — MoO 2×2 Rule decline';
    }
  }

  // Humana — binary accept/decline model; no filed rated classes.
  if (carrierName === 'Humana' && adjustedScore < 70) {
    return 'Humana is accept-or-decline — score below Preferred/Standard threshold';
  }

  // MoO (NC) binary fallback if the 2×2 specifics didn't fire.
  if (carrierName === 'Mutual of Omaha' && adjustedScore < 70) {
    return 'MoO NC does not offer rated classes — score below Standard threshold';
  }

  return null;
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
  const medsResult = scoreMeds(inputs.meds, inputs.health);
  const buildScoreValue = scoreBuild(inputs.heightIn, inputs.weightLbs);
  const tobaccoScore = scoreTobacco(inputs.tobacco);

  const universalKo = universalKnockoutReason(inputs.meds, inputs.health);

  const rawOverall = Math.max(
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

  // A universal knockout (cancer, transplant, dialysis, hospice, etc.)
  // zeros out the whole profile — the weighted average would otherwise
  // show 60–70% just from meds/build/tobacco being full.
  const overall = universalKo ? 0 : rawOverall;

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

  const declineRc: RateClass = { name: 'Likely Decline', lo: 0, hi: 0, badge: 'high-rated' };

  const carriers: CarrierResult[] = CARRIERS.map((c) => {
    // Universal knockouts apply to every carrier uniformly.
    if (universalKo) {
      return {
        name: c.name,
        score: 0,
        tone: 'low' as const,
        rateClass: declineRc,
        planGLo: 0,
        planGHi: 0,
        planNLo: 0,
        planNHi: 0,
        reason: 'Universal decline — applies to all carriers.',
        discount: c.discount,
        ctaLabel: 'Call Rob to discuss',
        hardKnockout: true,
        knockoutReason: universalKo,
      };
    }

    const adjusted = adjustCarrierScore(
      c.name,
      overall,
      inputs.meds,
      medsResult.clusters,
      inputs.health,
    );

    // Carrier-specific knockouts (MoO 2×2, MoO/Humana binary below Standard).
    const koReason = carrierKnockoutReason(c.name, adjusted, medsResult.clusters, inputs.health);
    if (koReason) {
      return {
        name: c.name,
        score: 0,
        tone: 'low' as const,
        rateClass: declineRc,
        planGLo: 0,
        planGHi: 0,
        planNLo: 0,
        planNHi: 0,
        reason: `${c.name} does not write this profile.`,
        discount: c.discount,
        ctaLabel: 'Call Rob to discuss',
        hardKnockout: true,
        knockoutReason: koReason,
      };
    }

    // Binary carriers (MoO-NC, Humana) collapse rated tiers to Standard —
    // if we get here, adjusted ≥ 70, so pick Preferred or Standard only.
    const rc = BINARY_NC_CARRIERS.has(c.name)
      ? adjusted >= 85
        ? { name: 'Preferred', lo: 0.85, hi: 0.95, badge: 'preferred' as const }
        : { name: 'Standard', lo: 0.95, hi: 1.05, badge: 'standard' as const }
      : rateClassForScore(adjusted);

    return {
      name: c.name,
      score: adjusted,
      tone: toneForScore(adjusted),
      rateClass: rc,
      planGLo: rc.lo > 0 ? Math.round(gRate * c.gA * rc.lo) : 0,
      planGHi: rc.hi > 0 ? Math.round(gRate * c.gA * rc.hi) : 0,
      planNLo: rc.lo > 0 ? Math.round(nRate * c.nA * rc.lo) : 0,
      planNHi: rc.hi > 0 ? Math.round(nRate * c.nA * rc.hi) : 0,
      reason: reasonForCarrier(c.name, adjusted, rc),
      discount: c.discount,
      ctaLabel: ctaLabel(adjusted),
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
