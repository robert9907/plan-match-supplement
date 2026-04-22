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
  | 'respiratory'
  | 'mental'
  | 'pain'
  | 'neuro'
  | 'cancer'
  | 'autoimmune'
  | 'renal'
  | 'transplant';

export interface DdlEntry {
  condition: string | null;
  declineAll: boolean;
  note?: string;
  carrierException?: string;
  cluster?: DdlCluster;
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

  // Cardio cluster — no individual flag, combo scoring applies
  eliquis: { condition: null, declineAll: false, cluster: 'cardio' },
  xarelto: { condition: null, declineAll: false, cluster: 'cardio' },
  warfarin: { condition: null, declineAll: false, cluster: 'cardio' },
  lisinopril: { condition: null, declineAll: false, cluster: 'cardio' },
  amlodipine: { condition: null, declineAll: false, cluster: 'cardio' },
  atorvastatin: { condition: null, declineAll: false, cluster: 'cardio' },
  losartan: { condition: null, declineAll: false, cluster: 'cardio' },
  metoprolol: { condition: null, declineAll: false, cluster: 'cardio' },
  plavix: { condition: null, declineAll: false, cluster: 'cardio' },

  // Diabetes cluster — combo scoring applies
  metformin: { condition: null, declineAll: false, cluster: 'diabetes' },
  ozempic: { condition: null, declineAll: false, cluster: 'diabetes' },
  jardiance: { condition: null, declineAll: false, cluster: 'diabetes' },
  lantus: { condition: null, declineAll: false, cluster: 'diabetes' },
  glipizide: { condition: null, declineAll: false, cluster: 'diabetes' },
  trulicity: { condition: null, declineAll: false, cluster: 'diabetes' },
  januvia: { condition: null, declineAll: false, cluster: 'diabetes' },
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
  { name: 'Glipizide', detail: 'Sulfonylurea · 10mg', dose: '10mg' },
  { name: 'Eliquis (apixaban)', detail: 'Blood thinner · 5mg', dose: '5mg' },
  { name: 'Xarelto', detail: 'Blood thinner · 20mg', dose: '20mg' },
  { name: 'Warfarin', detail: 'Blood thinner · 5mg', dose: '5mg' },
  { name: 'Plavix', detail: 'Antiplatelet · 75mg', dose: '75mg' },
  { name: 'Lisinopril', detail: 'ACE inhibitor · 20mg', dose: '20mg' },
  { name: 'Amlodipine', detail: 'CCB · 10mg', dose: '10mg' },
  { name: 'Metoprolol', detail: 'Beta blocker · 50mg', dose: '50mg' },
  { name: 'Losartan', detail: 'ARB · 100mg', dose: '100mg' },
  { name: 'Atorvastatin', detail: 'Statin · 40mg', dose: '40mg' },
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
