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
  /** Endothelin/PDE5/prostacyclin therapies for pulmonary arterial
   * hypertension — universal-decline class. Kept distinct from
   * 'respiratory' (COPD/asthma) so combo math doesn't conflate them. */
  | 'pulmonary'
  /** HIV / antiretroviral therapy — universal-decline class. */
  | 'hiv'
  /** Hepatitis C direct-acting antivirals. Carriers diverge on
   * post-SVR applicants; the entry's note carries the caveat. */
  | 'hepatitis'
  /** Growth-hormone replacement, anti-amyloid Alzheimer agents,
   * other endocrine specialty drugs that don't fit elsewhere. */
  | 'endocrine'
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
  orencia: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  xeljanz: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  rinvoq: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  skyrizi: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  cosentyx: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  otezla: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  kevzara: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  actemra: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  stelara: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  taltz: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  tremfya: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  cimzia: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  simponi: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  inflectra: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },
  renflexis: { condition: 'Autoimmune biologic', declineAll: true, cluster: 'autoimmune' },

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
  tecfidera: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  ocrevus: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  kesimpta: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  aubagio: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  tysabri: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  gilenya: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  mayzent: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  vumerity: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  zeposia: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  ponvory: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },
  bafiertam: { condition: 'Multiple Sclerosis', declineAll: true, cluster: 'neuro' },

  // Cancer — active treatment
  gleevec: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  tamoxifen: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  ibrance: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  keytruda: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  opdivo: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  revlimid: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  pomalyst: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  imbruvica: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  lynparza: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  tagrisso: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  letrozole: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  arimidex: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  lupron: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  xtandi: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  zytiga: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  erleada: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  calquence: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  brukinsa: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  verzenio: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  kisqali: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  enhertu: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },
  trodelvy: { condition: 'Cancer (active)', declineAll: true, cluster: 'cancer' },

  // Pain — opioid flags
  fentanyl: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  oxycontin: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  hydrocodone: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  oxycodone: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  morphine: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  dilaudid: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  norco: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  percocet: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  opana: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  vicodin: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  roxicodone: { condition: 'Opioid (chronic)', declineAll: true, cluster: 'pain' },
  tramadol: {
    condition: 'Opioid (moderate)',
    declineAll: false,
    cluster: 'pain',
    note: 'Carrier-dependent — Cigna/Bankers may accept',
  },
  nucynta: {
    condition: 'Opioid (moderate)',
    declineAll: false,
    cluster: 'pain',
    note: 'Carrier-dependent — Cigna/Bankers may accept',
  },
  codeine: {
    condition: 'Opioid (mild — schedule III–V)',
    declineAll: false,
    cluster: 'pain',
  },

  // Mental health — severe
  abilify: { condition: 'Schizophrenia/Bipolar', declineAll: true, cluster: 'mental' },
  depakote: { condition: 'Bipolar', declineAll: true, cluster: 'mental' },
  clozaril: {
    condition: 'Treatment-resistant schizophrenia',
    declineAll: true,
    cluster: 'mental',
    note: 'Universal decline across all carriers — indicates severe psychiatric condition',
  },

  // Transplant / anti-rejection — universal decline. tacrolimus +
  // cellcept land here for completeness alongside the broader rejection
  // ladder; carriers treat every entry below as a knockout regardless
  // of which organ.
  cellcept: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  tacrolimus: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  cyclosporine: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  mycophenolate: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  sirolimus: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  everolimus: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  prograf: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  neoral: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },
  rapamune: { condition: 'Organ transplant / anti-rejection', declineAll: true, cluster: 'transplant' },

  // Pulmonary arterial hypertension — endothelin / PDE5 / prostacyclin
  // class. Universal decline because the diagnosis itself (PAH, WHO
  // Group 1) is a knockout independent of which agent. NOTE: sildenafil
  // and tadalafil are intentionally NOT in this list. At standard
  // 20–100 mg doses they treat ED / BPH and are non-declinable; only
  // PAH-strength dosing (Revatio 20 mg TID, Adcirca 40 mg QD)
  // indicates PAH. The first-word DDL lookup can't distinguish dose,
  // so flagging the ingredient would knock out every Viagra/Cialis
  // user — wrong direction for false positives. The PAH cluster catches
  // anyone whose med list contains a real pulmonary-only agent.
  bosentan: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  ambrisentan: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  macitentan: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  riociguat: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  treprostinil: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  epoprostenol: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  opsumit: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  tracleer: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  letairis: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  uptravi: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  orenitram: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  veletri: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },
  flolan: { condition: 'Pulmonary arterial hypertension', declineAll: true, cluster: 'pulmonary' },

  // HIV / antiretroviral therapy — universal decline across all major
  // Medigap carriers. Combination single-tablet regimens dominate; the
  // first-word brand match catches each.
  biktarvy: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  descovy: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  truvada: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  genvoya: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  odefsey: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  triumeq: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  dovato: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  cabenuva: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  juluca: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  symtuza: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  complera: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  atripla: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },
  stribild: { condition: 'HIV/AIDS (antiretroviral therapy)', declineAll: true, cluster: 'hiv' },

  // Hepatitis C direct-acting antivirals. Active treatment is a
  // universal decline. Post-SVR (cured) applicants who can produce a
  // documented SVR12 may qualify with select carriers — carrier-
  // dependent — so the note flags this for the broker to chase, but
  // the default ranking treats the drug as a knockout.
  harvoni: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },
  epclusa: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },
  mavyret: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },
  vosevi: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },
  zepatier: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },
  sovaldi: {
    condition: 'Hepatitis C (DAA therapy)',
    declineAll: true,
    cluster: 'hepatitis',
    note: 'Post-SVR (cured) applicants may qualify with documented SVR12 — carrier-dependent',
  },

  // Growth hormone replacement (adult). Universal decline — adult-
  // onset GHD itself is the knockout; carriers don't ladder this.
  somatropin: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  genotropin: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  norditropin: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  humatrope: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  saizen: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  omnitrope: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },
  nutropin: { condition: 'Growth hormone deficiency (adult)', declineAll: true, cluster: 'endocrine' },

  // Anti-amyloid Alzheimer therapy. New class as of 2023 — both donanemab
  // (Kisunla) and lecanemab (Leqembi) are universal decline because the
  // confirmed early-AD diagnosis they require is itself a knockout.
  // aducanumab/Aduhelm withdrawn by Biogen in 2024 but kept here for
  // legacy medication-list matches.
  lecanemab: { condition: 'Alzheimer disease (anti-amyloid therapy)', declineAll: true, cluster: 'neuro' },
  leqembi: { condition: 'Alzheimer disease (anti-amyloid therapy)', declineAll: true, cluster: 'neuro' },
  donanemab: { condition: 'Alzheimer disease (anti-amyloid therapy)', declineAll: true, cluster: 'neuro' },
  aducanumab: { condition: 'Alzheimer disease (anti-amyloid therapy)', declineAll: true, cluster: 'neuro' },
  aduhelm: { condition: 'Alzheimer disease (anti-amyloid therapy)', declineAll: true, cluster: 'neuro' },

  // Clozapine / Clozaril / Fazaclo — universal decline. Indicated only
  // for treatment-resistant schizophrenia + reserved for the most
  // severe presentations because of the agranulocytosis monitoring
  // burden. The script-level flag already catches clozaril above; we
  // re-list it here under the unified condition string so a future
  // carrier crossref doesn't see it as an orphan.
  clozapine: {
    condition: 'Treatment-resistant schizophrenia',
    declineAll: true,
    cluster: 'mental',
    note: 'Universal decline across all carriers — indicates severe psychiatric condition',
  },
  fazaclo: {
    condition: 'Treatment-resistant schizophrenia',
    declineAll: true,
    cluster: 'mental',
    note: 'Universal decline across all carriers — indicates severe psychiatric condition',
  },

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
  humulin: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  admelog: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  semglee: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  rezvoglar: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  lyumjev: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
  rybelsus: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 2 },

  // Renal — CKD / PKD / hyperparathyroidism markers. Universal decline:
  // each of these is prescribed for a specific kidney-disease diagnosis
  // that carriers flag on every product.
  jynarque: { condition: 'Polycystic kidney disease', declineAll: true, cluster: 'renal' },
  sensipar: { condition: 'Secondary hyperparathyroidism / CKD', declineAll: true, cluster: 'renal' },
  parsabiv: { condition: 'Secondary hyperparathyroidism / CKD', declineAll: true, cluster: 'renal' },
  auryxia: { condition: 'CKD phosphate binder', declineAll: true, cluster: 'renal' },
  veltassa: { condition: 'CKD potassium binder', declineAll: true, cluster: 'renal' },
  phoslyra: { condition: 'CKD phosphate binder', declineAll: true, cluster: 'renal' },

  // Generic-name fallback — first-word "insulin" catches generic
  // descriptors like "insulin glargine" / "insulin aspart" that don't
  // match a brand entry above. Same severity as the insulin brands.
  insulin: { condition: null, declineAll: false, cluster: 'diabetes', severityTier: 3, isInsulin: true },
};

// Look up a DDL entry given a user-typed or shared-library-returned
// drug name. Strategy: strip parentheses, take the first word, lowercase.
// Drug catalog search now lives in src/lib/drugSearch.ts (consumer
// Plan Match shared library); this table is only the underwriting
// classifier and stays local.
export function ddlLookup(drugName: string): DdlEntry | undefined {
  const key = drugName.split('(')[0].trim().split(' ')[0].toLowerCase();
  return DDL[key];
}
