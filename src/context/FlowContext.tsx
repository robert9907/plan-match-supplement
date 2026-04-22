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
  partAEffective: string;
  partBEffective: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  zip: string;
  authChecks: [boolean, boolean, boolean, boolean];
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
  setHealth: (updater: (prev: HealthAnswers) => HealthAnswers) => void;
  setHeight: (inches: number | null) => void;
  setWeight: (lbs: number | null) => void;
  setScoring: (s: ScoringResult) => void;
  selectCarrier: (c: CarrierResult, plan: 'G' | 'N') => void;
  updateApplication: (patch: Partial<ApplicationData>) => void;
  toggleAuthCheck: (index: 0 | 1 | 2 | 3) => void;
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
    partAEffective: '',
    partBEffective: '',
    phone: '',
    email: '',
    addressLine: '',
    city: '',
    state: 'NC',
    zip: '',
    authChecks: [false, false, false, false],
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

  const toggleAuthCheck = useCallback((index: 0 | 1 | 2 | 3) => {
    setState((s) => {
      const next = [...s.application.authChecks] as [boolean, boolean, boolean, boolean];
      next[index] = !next[index];
      return { ...s, application: { ...s.application, authChecks: next } };
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
