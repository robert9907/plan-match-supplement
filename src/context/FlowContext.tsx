import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { CarrierResult, MedItem, ScoringResult } from '../lib/scoringEngine';
import { emptyHealthAnswers, type HealthAnswers } from '../lib/scoringEngine';

// ─── Types ───────────────────────────────────────────────────────

/** A doctor on the applicant's file. `npi` (and the enrichment that
 *  rides with it) is present when the entry came from the NPI Registry
 *  search rather than being typed free-hand. */
export interface ProviderEntry {
  name: string;
  npi?: string;
  specialty?: string;
  address?: string;
}

export type PromptReason =
  | 'Turning 65'
  | 'Switching plans'
  | 'Leaving MA'
  | 'Rate increase'
  | 'Exploring'
  | null;

export interface DobState {
  month: string; // "01".."12" or ""
  day: string; // "1".."31" or ""
  year: string; // "1930".."2008" or ""
}

export interface ApplicationData {
  firstName: string;
  lastName: string;
  mbi: string;
  securityPin: string;
  partAEffective: string;
  partBEffective: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  // 5-tuple as of W2 Fix 4: indices 0-3 are the carrier underwriting
  // authorizations; index 4 is the TCPA prior-express-written-consent
  // block (split out of the prior composite #3 per FCC One-to-One
  // Consent rule eff. 2025-01-27). 47 USC 227 + 47 CFR 64.1200(f)(9).
  authChecks: [boolean, boolean, boolean, boolean, boolean];
  /** ISO timestamp captured when authChecks[4] (TCPA) flipped true.
   *  Burden-of-proof evidence; cleared back to null on untoggle. */
  tcpaConsentAt: string | null;
  signedAt: string | null;
}

export interface FlowState {
  // About You
  prompt: PromptReason;
  dob: DobState;
  gender: 'Male' | 'Female' | null;
  tobacco: 'Yes' | 'No' | null;
  zip: string;

  // Meds
  meds: MedItem[];

  // Providers. Supplements have no networks, so nothing here gates plan
  // eligibility — but the NPI is what AgentBase matches on when it links
  // a doctor to its providers directory, so capture it when the search
  // resolves one. Free-typed entries still land with npi undefined.
  providers: ProviderEntry[];

  // Health + build
  health: HealthAnswers;
  heightIn: number | null;
  weightLbs: number | null;

  // Results
  scoring: ScoringResult | null;
  selectedCarrier: CarrierResult | null;
  selectedPlan: 'G' | 'N';

  // Application
  application: ApplicationData;
}

interface FlowContextValue extends FlowState {
  setPrompt: (p: PromptReason) => void;
  setDob: (d: DobState) => void;
  setGender: (g: 'Male' | 'Female') => void;
  setTobacco: (t: 'Yes' | 'No') => void;
  setZip: (z: string) => void;
  addMed: (m: MedItem) => void;
  removeMed: (index: number) => void;
  setMeds: (m: MedItem[]) => void;
  addProvider: (p: ProviderEntry) => void;
  removeProvider: (index: number) => void;
  setProviders: (p: ProviderEntry[]) => void;
  setHealth: (updater: (prev: HealthAnswers) => HealthAnswers) => void;
  setHeight: (inches: number | null) => void;
  setWeight: (lbs: number | null) => void;
  setScoring: (s: ScoringResult) => void;
  selectCarrier: (c: CarrierResult, plan: 'G' | 'N') => void;
  updateApplication: (patch: Partial<ApplicationData>) => void;
  toggleAuthCheck: (index: 0 | 1 | 2 | 3 | 4) => void;
  sign: () => void;
  age: number;
  isOep: boolean;
  reset: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

export function computeAge(dob: DobState, now: Date = new Date()): number {
  const year = Number.parseInt(dob.year, 10);
  if (!Number.isFinite(year) || year < 1900) return 0;
  const month = Number.parseInt(dob.month, 10);
  const day = Number.parseInt(dob.day, 10);
  let age = now.getFullYear() - year;
  if (
    Number.isFinite(month) &&
    Number.isFinite(day) &&
    (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day))
  ) {
    age--;
  }
  return age;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatDob(dob: DobState): string {
  const m = Number.parseInt(dob.month, 10);
  if (!Number.isFinite(m) || m < 1 || m > 12 || !dob.day || !dob.year) return '—';
  return `${MONTH_NAMES[m - 1]} ${Number(dob.day)}, ${dob.year}`;
}

function emptyApplication(): ApplicationData {
  return {
    firstName: '',
    lastName: '',
    mbi: '',
    securityPin: '',
    partAEffective: '',
    partBEffective: '',
    phone: '',
    email: '',
    addressLine: '',
    city: '',
    state: 'NC',
    zip: '',
    authChecks: [false, false, false, false, false],
    tcpaConsentAt: null,
    signedAt: null,
  };
}

const EMPTY_STATE: FlowState = {
  prompt: null,
  dob: { month: '', day: '', year: '' },
  gender: null,
  tobacco: null,
  zip: '',
  meds: [],
  providers: [],
  health: emptyHealthAnswers(),
  heightIn: null,
  weightLbs: null,
  scoring: null,
  selectedCarrier: null,
  selectedPlan: 'G',
  application: emptyApplication(),
};

// ─── Provider ────────────────────────────────────────────────────

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlowState>(EMPTY_STATE);

  const setPrompt = useCallback((prompt: PromptReason) => {
    setState((s) => ({ ...s, prompt }));
  }, []);
  const setDob = useCallback((dob: DobState) => setState((s) => ({ ...s, dob })), []);
  const setGender = useCallback((gender: 'Male' | 'Female') => setState((s) => ({ ...s, gender })), []);
  const setTobacco = useCallback((tobacco: 'Yes' | 'No') => setState((s) => ({ ...s, tobacco })), []);
  const setZip = useCallback((zip: string) => setState((s) => ({ ...s, zip })), []);

  const addMed = useCallback((m: MedItem) => {
    setState((s) => {
      if (s.meds.some((x) => x.name === m.name)) return s;
      return { ...s, meds: [...s.meds, m] };
    });
  }, []);
  const removeMed = useCallback((index: number) => {
    setState((s) => ({ ...s, meds: s.meds.filter((_, i) => i !== index) }));
  }, []);
  const setMeds = useCallback((meds: MedItem[]) => setState((s) => ({ ...s, meds })), []);

  const addProvider = useCallback((p: ProviderEntry) => {
    setState((s) => {
      const name = p.name.trim();
      if (!name) return s;
      // NPI first: the same clinician can surface under slightly
      // different display names ("Dr. Sarah Chen" vs "Sarah Chen, MD"),
      // and a name-only check would let both through as two doctors.
      if (p.npi && s.providers.some((x) => x.npi === p.npi)) return s;
      const existingIdx = s.providers.findIndex(
        (x) => x.name.toLowerCase() === name.toLowerCase(),
      );
      if (existingIdx !== -1) {
        // Same name already on file. If the new entry carries an NPI and
        // the stored one doesn't, upgrade in place rather than dropping
        // the identifier on the floor — a free-typed name followed by a
        // search pick should end up resolved.
        const existing = s.providers[existingIdx];
        if (p.npi && !existing.npi) {
          const providers = [...s.providers];
          providers[existingIdx] = { ...existing, ...p, name };
          return { ...s, providers };
        }
        return s;
      }
      return { ...s, providers: [...s.providers, { ...p, name }] };
    });
  }, []);
  const removeProvider = useCallback((index: number) => {
    setState((s) => ({ ...s, providers: s.providers.filter((_, i) => i !== index) }));
  }, []);
  const setProviders = useCallback(
    (providers: ProviderEntry[]) => setState((s) => ({ ...s, providers })),
    [],
  );

  const setHealth = useCallback(
    (updater: (prev: HealthAnswers) => HealthAnswers) =>
      setState((s) => ({ ...s, health: updater(s.health) })),
    [],
  );
  const setHeight = useCallback((heightIn: number | null) => setState((s) => ({ ...s, heightIn })), []);
  const setWeight = useCallback((weightLbs: number | null) => setState((s) => ({ ...s, weightLbs })), []);

  const setScoring = useCallback(
    (scoring: ScoringResult) => setState((s) => ({ ...s, scoring })),
    [],
  );

  const selectCarrier = useCallback((carrier: CarrierResult, plan: 'G' | 'N') => {
    setState((s) => ({ ...s, selectedCarrier: carrier, selectedPlan: plan }));
  }, []);

  const updateApplication = useCallback((patch: Partial<ApplicationData>) => {
    setState((s) => ({ ...s, application: { ...s.application, ...patch } }));
  }, []);

  const toggleAuthCheck = useCallback((index: 0 | 1 | 2 | 3 | 4) => {
    setState((s) => {
      const next = [...s.application.authChecks] as [
        boolean,
        boolean,
        boolean,
        boolean,
        boolean,
      ];
      next[index] = !next[index];
      // Stamp / clear the TCPA timestamp alongside the index-4 toggle.
      // Burden-of-proof evidence under FCC One-to-One Consent rule.
      const tcpaConsentAt =
        index === 4
          ? next[4]
            ? new Date().toISOString()
            : null
          : s.application.tcpaConsentAt;
      return {
        ...s,
        application: { ...s.application, authChecks: next, tcpaConsentAt },
      };
    });
  }, []);

  const sign = useCallback(() => {
    setState((s) => ({
      ...s,
      application: { ...s.application, signedAt: new Date().toISOString() },
    }));
  }, []);

  const reset = useCallback(() => setState(EMPTY_STATE), []);

  const age = useMemo(() => computeAge(state.dob), [state.dob]);
  const isOep = state.prompt === 'Turning 65';

  const value: FlowContextValue = {
    ...state,
    setPrompt,
    setDob,
    setGender,
    setTobacco,
    setZip,
    addMed,
    removeMed,
    setMeds,
    addProvider,
    removeProvider,
    setProviders,
    setHealth,
    setHeight,
    setWeight,
    setScoring,
    selectCarrier,
    updateApplication,
    toggleAuthCheck,
    sign,
    age,
    isOep,
    reset,
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used inside <FlowProvider>');
  return ctx;
}

export { MONTH_NAMES };
