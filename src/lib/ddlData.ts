// ─── DDL cross-reference ─────────────────────────────────────────
//
// Every Medicare Supplement carrier maintains a Declinable Drug List (DDL).
// Certain medications signal conditions that carriers won't underwrite
// (autoimmune biologics, active cancer, opioids, antipsychotics, etc.).
// Some drugs are partial flags — accepted by specific carriers at rated
// classes, declined elsewhere.
//
// `cluster` groups drugs for combination scoring in scoringEngine.ts. A
// consumer on 2+ diabetes meds AND 2+ cardiovascular meds is the combo
// carriers hate most — individual drugs may all be fine, the combination
// triggers decline.

export type DdlCluster =
  | 'diabetes'
  | 'cardio'
  | 'anticoagulant'
  | 'respiratory'
  | 'mental'
  | 'pain'
  | 'neuro'
  | 'cancer'
  | 'autoimmune'
  | 'renal'
  | 'transplant'
  /** Gabapentin / Lyrica / Cymbalta — only flag in combination with
   * diabetes, where underwriters infer diabetic neuropathy. Standalone
   * they have many benign uses (fibromyalgia, sciatica, depression). */
  | 'neuropathyAdj';

export interface DdlEntry {
  condition: string | null;
  declineAll: boolean;
  note?: string;
  carrierException?: string;
  cluster?: DdlCluster;
  /** Insulin brands (any type/delivery) — underwriters treat insulin use as a
   * distinct severity signal on top of the diabetes cluster count. */
  isInsulin?: boolean;
  /** Severity tier within a cluster (diabetes / cardio). Underwriters read
   * drug stacks as an escalation ladder: tier 1 = first-line, tier 2 =
   * oral-failure / mid severity, tier 3 = advanced (insulin / HFrEF).
   * Used to detect escalation patterns independently of raw cluster count. */
  severityTier?: 1 | 2 | 3;
}

// Key = first word of drug name, lowercased. Matches the lookup strategy
// used in addMed() — brand names like "Ozempic (semaglutide)" reduce to
// "ozempic".
export const DDL: Record<string, DdlEntry> = {
  // Autoimmune biologics — universal decline
  humira: { condition: 'Rheumatoid Arthritis', declineAll: true, cluster: 'autoimmune' },
  enbrel: { condition: 'Rheumatoid Arthritis', declineAll: true, cluster: 'autoimmune' },
  remicade: { condition: 'Rheumatoid Arthritis', declineAll: true, cluster: 'autoimmune' },

  // Neurodegenerative — conditional by carrier
  aricept: {
    condition: "Alzheimer's",
    declineAll: false,
    note: 'Pref/Std only — rated classes decline',
    cluster: 'neuro',
  },
  namenda: {
    condition: "Alzheimer's",
    declineAll: false,
    note: 'Pref/Std only — rated classes decline',
    cluster: 'neuro',
  },
  sinemet: {
    condition: "Parkinson's",
    declineAll: false,
    note: "Parkinson's — Pref/Std decline",
    cluster: 'neuro',
  },
  copaxone: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },

  // Cancer — active treatment
  gleevec: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  tamoxifen: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },

  // Pain — opioid flags
  fentanyl: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  oxycontin: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },

  // Mental health — severe
  abilify: { condition: 'Schizophrenia/Bipolar', declineAll: true, cluster: 'mental' },
  depakote: { condition: 'Bipolar', declineAll: true, cluster: 'mental' },
  clozaril: { condition: 'Schizophrenia', declineAll: true, cluster: 'mental' },

  // Transplant — universal decline
  cellcept: { condition: 'Organ transplant', declineAll: true, cluster: 'transplant' },
  tacrolimus: { condition: 'Organ transplant', declineAll: true, cluster: 'transplant' },

  // COPD / respiratory — Cigna accepts at Std II/III when others decline
  spiriva: {
    condition: 'COPD',
    declineAll: false,
    carrierException: 'Cigna',
    note: 'Cigna Std II/III OK — others decline',
    cluster: 'respiratory',
  },
  breo: {
    condition: 'COPD',
    declineAll: false,
    carrierException: 'Cigna',
    note: 'Cigna Std II/III OK — others decline',
    cluster: 'respiratory',
  },
  symbicort: {
    condition: 'COPD',
    declineAll: false,
    carrierException: 'Cigna',
    note: 'Cigna Std II/III OK — others decline',
    cluster: 'respiratory',
  },
  advair: {
    condition: 'COPD',
    declineAll: false,
    carrierException: 'Cigna',
    cluster: 'respiratory',
  },

  // Severe / end-stage respiratory — universal decline
  trelegy: { condition: 'Severe COPD (triple therapy)', declineAll: true, cluster: 'respiratory' },
  stiolto: { condition: 'Severe COPD', declineAll: true, cluster: 'respiratory' },
  duoneb: { condition: 'Nebulized COPD therapy', declineAll: true, cluster: 'respiratory' },
  brovana: { condition: 'Nebulized COPD therapy', declineAll: true, cluster: 'respiratory' },
  nucala: { condition: 'Severe asthma biologic', declineAll: true, cluster: 'respiratory' },
  daliresp: { condition: 'End-stage COPD', declineAll: true, cluster: 'respiratory' },
  ofev: { condition: 'Idiopathic pulmonary fibrosis', declineAll: true, cluster: 'respiratory' },
  esbriet: { condition: 'Idiopathic pulmonary fibrosis', declineAll: true, cluster: 'respiratory' },

  // Opioid addiction / MAT — universal decline
  suboxone: { condition: 'Opioid addiction', declineAll: true, cluster: 'pain' },
  buprenorphine: { condition: 'Opioid addiction', declineAll: true, cluster: 'pain' },
  methadone: { condition: 'Opioid addiction / chronic pain', declineAll: true, cluster: 'pain' },
  subutex: { condition: 'Opioid addiction', declineAll: true, cluster: 'pain' },

  // Anticoagulant cluster — read by underwriters as a proxy for AFib,
  // post-stent, DVT/PE, mechanical valve, or recent stroke/TIA. Carries
  // more weight than routine BP/statin meds.
  eliquis: {
    condition: null,
    declineAll: false,
    cluster: 'anticoagulant',
    note: 'Anticoagulant — signals AFib / post-stent / DVT',
  },
  xarelto: {
    condition: null,
    declineAll: false,
    cluster: 'anticoagulant',
    note: 'Anticoagulant — signals AFib / post-stent / DVT',
  },
  warfarin: {
    condition: null,
    declineAll: false,
    cluster: 'anticoagulant',
    note: 'Anticoagulant — signals AFib / mechanical valve / DVT',
  },
  pradaxa: {
    condition: null,
    declineAll: false,
    cluster: 'anticoagulant',
    note: 'Anticoagulant — signals AFib / post-stroke',
  },
  plavix: {
    condition: null,
    declineAll: false,
    cluster: 'anticoagulant',
    note: 'Antiplatelet — signals post-stent / post-MI / recent TIA',
  },

  // Cardio cluster — routine BP/cholesterol meds, combo scoring applies.
  // severityTier lets the engine detect escalation vs baseline HTN/chol.
  lisinopril: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 1 },
  amlodipine: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 1 },
  atorvastatin: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 1 },
  losartan: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 1 },
  metoprolol: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 2 },
  atenolol: { condition: null, declineAll: false, cluster: 'cardio', severityTier: 2 },
  furosemide: {
    condition: null,
    declineAll: false,
    cluster: 'cardio',
    severityTier: 2,
    note: 'Loop diuretic — CHF / fluid overload signal',
  },
  lasix: {
    condition: null,
    declineAll: false,
    cluster: 'cardio',
    severityTier: 2,
    note: 'Loop diuretic — CHF / fluid overload signal',
  },
  carvedilol: {
    condition: null,
    declineAll: false,
    cluster: 'cardio',
    severityTier: 3,
    note: 'HFrEF-indicated beta blocker — elevated cardiac severity',
  },

  // Cardio — universal decline (named on Cigna/ARLIC DDL)
  amiodarone: { condition: 'Serious arrhythmia', declineAll: true, cluster: 'cardio' },
  cordarone: { condition: 'Serious arrhythmia', declineAll: true, cluster: 'cardio' },
  pacerone: { condition: 'Serious arrhythmia', declineAll: true, cluster: 'cardio' },
  nexterone: { condition: 'Serious arrhythmia', declineAll: true, cluster: 'cardio' },
  entresto: { condition: 'Chronic heart failure', declineAll: true, cluster: 'cardio' },
  ranexa: { condition: 'Chronic angina', declineAll: true, cluster: 'cardio' },
  ranolazine: { condition: 'Chronic angina', declineAll: true, cluster: 'cardio' },
  repatha: { condition: 'PCSK9 — high-risk ASCVD', declineAll: true, cluster: 'cardio' },
  praluent: { condition: 'PCSK9 — high-risk ASCVD', declineAll: true, cluster: 'cardio' },
  leqvio: { condition: 'PCSK9 — high-risk ASCVD', declineAll: true, cluster: 'cardio' },

  // Neuropathy-adjacent drugs — benign standalone, but paired with
  // diabetes they infer diabetic neuropathy (a carrier knockout).
  gabapentin: { condition: null, declineAll: false, cluster: 'neuropathyAdj' },
  lyrica: { condition: null, declineAll: false, cluster: 'neuropathyAdj' },
  pregabalin: { condition: null, declineAll: false, cluster: 'neuropathyAdj' },
  cymbalta: { condition: null, declineAll: false, cluster: 'neuropathyAdj' },
  duloxetine: { condition: null, declineAll: false, cluster: 'neuropathyAdj' },

  // Diabetes cluster — severity tiers reflect the escalation ladder:
  // tier 1 = first-line oral, tier 2 = oral-failure / GLP-1, tier 3 =
  // beta-cell exhaustion / insulin. `isInsulin` persists for rules that
  // care about insulin specifically (e.g., insulin + cardiac knockout).
  metformin: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 1 },
  januvia: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 1 },
  glipizide: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 1 },
  jardiance: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 1 },
  ozempic: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 2 },
  trulicity: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 2 },
  victoza: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 2 },
  bydureon: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 2 },
  lantus: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  novolog: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  humalog: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  basaglar: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  tresiba: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  levemir: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  toujeo: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  apidra: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  fiasp: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
};

export interface DrugCatalogItem {
  name: string;
  detail: string;
  dose: string;
}

export const DRUG_CATALOG: DrugCatalogItem[] = [
  { name: 'Metformin', detail: 'Oral diabetes · 1000mg', dose: '1000mg' },
  { name: 'Ozempic (semaglutide)', detail: 'GLP-1 · 1mg', dose: '1mg' },
  { name: 'Jardiance', detail: 'SGLT2 · 25mg', dose: '25mg' },
  { name: 'Trulicity', detail: 'GLP-1 · 1.5mg', dose: '1.5mg' },
  { name: 'Januvia', detail: 'DPP-4 · 100mg', dose: '100mg' },
  { name: 'Lantus (insulin glargine)', detail: 'Insulin · 20u', dose: '20u' },
  { name: 'Novolog (insulin aspart)', detail: 'Insulin · 10u', dose: '10u' },
  { name: 'Humalog (insulin lispro)', detail: 'Insulin · 10u', dose: '10u' },
  { name: 'Basaglar', detail: 'Insulin · 20u', dose: '20u' },
  { name: 'Tresiba', detail: 'Insulin · 20u', dose: '20u' },
  { name: 'Levemir', detail: 'Insulin · 20u', dose: '20u' },
  { name: 'Toujeo', detail: 'Insulin · 20u', dose: '20u' },
  { name: 'Glipizide', detail: 'Sulfonylurea · 10mg', dose: '10mg' },
  { name: 'Eliquis (apixaban)', detail: 'Anticoagulant · 5mg', dose: '5mg' },
  { name: 'Xarelto', detail: 'Anticoagulant · 20mg', dose: '20mg' },
  { name: 'Warfarin', detail: 'Anticoagulant · 5mg', dose: '5mg' },
  { name: 'Pradaxa', detail: 'Anticoagulant · 150mg', dose: '150mg' },
  { name: 'Plavix', detail: 'Antiplatelet · 75mg', dose: '75mg' },
  { name: 'Lisinopril', detail: 'ACE inhibitor · 20mg', dose: '20mg' },
  { name: 'Amlodipine', detail: 'CCB · 10mg', dose: '10mg' },
  { name: 'Metoprolol', detail: 'Beta blocker · 50mg', dose: '50mg' },
  { name: 'Carvedilol', detail: 'Beta blocker · 12.5mg', dose: '12.5mg' },
  { name: 'Losartan', detail: 'ARB · 100mg', dose: '100mg' },
  { name: 'Atorvastatin', detail: 'Statin · 40mg', dose: '40mg' },
  { name: 'Furosemide (Lasix)', detail: 'Loop diuretic · 40mg', dose: '40mg' },
  { name: 'Amiodarone', detail: 'Antiarrhythmic · 200mg', dose: '200mg' },
  { name: 'Entresto', detail: 'Heart failure · 97/103mg', dose: '97/103' },
  { name: 'Repatha', detail: 'PCSK9 inhibitor · 140mg', dose: '140mg' },
  { name: 'Victoza', detail: 'GLP-1 · 1.8mg', dose: '1.8mg' },
  { name: 'Gabapentin', detail: 'Neuropathy · 300mg', dose: '300mg' },
  { name: 'Lyrica (pregabalin)', detail: 'Neuropathy · 75mg', dose: '75mg' },
  { name: 'Cymbalta', detail: 'SNRI · 60mg', dose: '60mg' },
  { name: 'Suboxone', detail: 'MAT · 8/2mg', dose: '8/2' },
  { name: 'Trelegy Ellipta', detail: 'Severe COPD triple', dose: '100/62.5/25' },
  { name: 'Nucala', detail: 'Severe asthma biologic · 100mg', dose: '100mg' },
  { name: 'Humira (adalimumab)', detail: 'RA biologic · 40mg', dose: '40mg' },
  { name: 'Enbrel', detail: 'RA biologic · 50mg', dose: '50mg' },
  { name: 'Spiriva', detail: 'COPD inhaler · 18mcg', dose: '18mcg' },
  { name: 'Breo Ellipta', detail: 'COPD inhaler', dose: '100/25' },
  { name: 'Symbicort', detail: 'COPD inhaler', dose: '160/4.5' },
  { name: 'Advair', detail: 'COPD inhaler', dose: '250/50' },
  { name: 'Gleevec (imatinib)', detail: 'Cancer · 400mg', dose: '400mg' },
  { name: 'Tamoxifen', detail: 'Cancer · 20mg', dose: '20mg' },
  { name: 'Fentanyl patch', detail: 'Opioid · 25mcg', dose: '25mcg' },
  { name: 'OxyContin', detail: 'Opioid · 20mg', dose: '20mg' },
  { name: 'Abilify', detail: 'Antipsychotic · 10mg', dose: '10mg' },
  { name: 'Depakote', detail: 'Mood stabilizer · 500mg', dose: '500mg' },
  { name: 'Sinemet', detail: "Parkinson's · 25/100mg", dose: '25/100' },
  { name: 'Aricept', detail: "Alzheimer's · 10mg", dose: '10mg' },
  { name: 'Namenda', detail: "Alzheimer's · 10mg", dose: '10mg' },
  { name: 'Copaxone', detail: 'MS · 40mg', dose: '40mg' },
  { name: 'CellCept', detail: 'Transplant · 500mg', dose: '500mg' },
];

// Look up a DDL entry given a drug name from the catalog or a user-typed
// string. Strategy: strip parentheses, take the first word, lowercase.
export function ddlLookup(drugName: string): DdlEntry | undefined {
  const key = drugName.split('(')[0].trim().split(' ')[0].toLowerCase();
  return DDL[key];
}
