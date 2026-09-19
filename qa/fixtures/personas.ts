// ---------------------------------------------------------------------------
// personas.ts — the applicants the harness drives through the flow.
//
// Chosen to cover the branches that change which disclosures are required:
//
//   oep-nc           Turning 65 → OEP. /rates skips Meds + Health straight to
//                    /results. Scores render "N/A"; the underwriting
//                    disclosure must still appear, and GI-rights language is
//                    the load-bearing disclosure on this path.
//   underwritten-nc  Switching plans → full path. Medical underwriting
//                    applies, so the score, the rate class, and the
//                    "acceptance is not guaranteed" language all render.
//   underwritten-tx  Rate increase, tobacco → TX. Exercises the state branch.
//                    Texas has NO rows in pm_medsup_rate_public, so the
//                    projection chart on /rates renders "Coming to Texas
//                    soon" — but pm_supp_carrier_rates_public DOES have TX,
//                    so /results renders a full carrier list. Two different
//                    rate sources; do not conflate them again.
//   unlicensed-ny    NY ZIP → the licensure gate must hold: Continue stays
//                    disabled and the 1-800-MEDICARE referral shows.
// ---------------------------------------------------------------------------

export type PromptChoice =
  | 'Turning 65'
  | 'Switching plans'
  | 'Leaving MA'
  | 'Rate increase'
  | 'Exploring';

export interface Persona {
  id: string;
  label: string;
  prompt: PromptChoice;
  /** Month value as the <select> stores it ("01".."12"). */
  dobMonth: string;
  dobDay: string;
  dobYear: string;
  gender: 'Male' | 'Female';
  tobacco: 'Yes' | 'No';
  zip: string;
  /** Expected resolved state, or null when the ZIP is outside NC/TX/GA. */
  state: 'NC' | 'TX' | 'GA' | null;
  /** True when the persona takes the OEP shortcut past Meds + Health. */
  oep: boolean;
  /** Medications typed on /meds. Empty uses the "I don't take any" skip. */
  meds: string[];
  /** Doctor typed on /providers. Empty uses the skip link. */
  providers: string[];
  /** Answers to the 12 health questions, in order. */
  health: Array<'Yes' | 'No'>;
  /** Value of the height <select>, in inches. */
  heightIn: number;
  weightLbs: number;
  /** Expected to reach /results at all. */
  reachesResults: boolean;
  /**
   * Set when this persona is expected to be stopped part-way by a KNOWN,
   * documented product gap rather than by a bug. The harness then asserts the
   * applicant is stopped with an explicit message instead of a silent spinner,
   * and records the gap in the report. When the gap is closed this persona
   * starts failing, which is the signal to clear this field.
   */
  blockedAt?: 'rates' | 'health';
  /** One line explaining the gap, printed in the report. */
  blockedReason?: string;
}

const ALL_NO: Array<'Yes' | 'No'> = Array.from({ length: 12 }, () => 'No');

export const PERSONAS: Persona[] = [
  {
    id: 'oep-nc',
    label: 'Turning 65, Durham NC, male, non-tobacco (open enrollment)',
    prompt: 'Turning 65',
    dobMonth: '03',
    dobDay: '14',
    dobYear: '1961',
    gender: 'Male',
    tobacco: 'No',
    zip: '27707',
    state: 'NC',
    oep: true,
    meds: [],
    providers: [],
    health: ALL_NO,
    heightIn: 70,
    weightLbs: 185,
    reachesResults: true,
  },
  {
    id: 'underwritten-nc',
    label: 'Switching plans, Durham NC, female, non-tobacco (underwritten)',
    prompt: 'Switching plans',
    dobMonth: '07',
    dobDay: '2',
    dobYear: '1954',
    gender: 'Female',
    tobacco: 'No',
    zip: '27707',
    state: 'NC',
    oep: false,
    meds: ['lisinopril'],
    providers: ['Sarah Chen'],
    // Diabetes = yes exercises the inline management slider, which is a
    // conditional control the Continue button waits on.
    health: ['No', 'No', 'No', 'No', 'No', 'No', 'Yes', 'No', 'No', 'No', 'No', 'No'],
    heightIn: 64,
    weightLbs: 155,
    reachesResults: true,
  },
  {
    id: 'underwritten-tx',
    label: 'Rate increase, Dallas TX, male, tobacco (underwritten, TX data gap)',
    prompt: 'Rate increase',
    dobMonth: '11',
    dobDay: '20',
    dobYear: '1957',
    gender: 'Male',
    tobacco: 'Yes',
    zip: '75001',
    state: 'TX',
    oep: false,
    meds: [],
    providers: [],
    health: ALL_NO,
    heightIn: 71,
    weightLbs: 210,
    // Reaches results. This persona asserted blockedAt: 'health' until
    // 2026-09-19, on the belief that no TX rate data existed anywhere. That
    // was wrong, and the mock had been written to agree with it — the suite
    // was green because it tested the assumption rather than the product.
    // Production serves 24 carrier families / 29 plans for a Dallas ZIP.
    reachesResults: true,
  },
  {
    id: 'unlicensed-ny',
    label: 'New York ZIP — outside NC/TX/GA licensure',
    prompt: 'Exploring',
    dobMonth: '05',
    dobDay: '9',
    dobYear: '1958',
    gender: 'Female',
    tobacco: 'No',
    zip: '10001',
    state: null,
    oep: false,
    meds: [],
    providers: [],
    health: ALL_NO,
    heightIn: 65,
    weightLbs: 140,
    reachesResults: false,
  },
];

export function personasFromEnv(): Persona[] {
  const filter = (process.env.PERSONAS ?? '').trim();
  if (!filter) return PERSONAS;
  const wanted = new Set(filter.split(',').map((s) => s.trim()).filter(Boolean));
  const picked = PERSONAS.filter((p) => wanted.has(p.id));
  return picked.length ? picked : PERSONAS;
}
