// Rob is appointed in NC, TX, GA. Any other state-of-residence is unlicensed.
// The Medicare Supplement (Medigap) flow must not surface NC rates to an
// out-of-state consumer and must not submit an application to a carrier on
// their behalf. NC GS § 58-33-26, TX Ins. Code § 4001.101, GA OCGA § 33-23-4
// (producer must be licensed in the consumer's resident state).

export const LICENSED_STATES = ['NC', 'TX', 'GA'] as const;
export type LicensedState = (typeof LICENSED_STATES)[number];

// Returns the licensed state for a 5-digit ZIP, or undefined when the prefix
// doesn't map to NC/TX/GA. Use this when an explicit "no licensed match"
// signal is needed (e.g. the About-screen gate). Mirrors the prefix table in
// api/rates.ts:stateForZip but returns undefined instead of defaulting to NC.
export function deriveLicensedStateOrUndefined(zip: string): LicensedState | undefined {
  if (!/^\d{5}$/.test(zip)) return undefined;
  const n = parseInt(zip.slice(0, 3), 10);
  if (n >= 270 && n <= 289) return 'NC';
  if (n >= 750 && n <= 799) return 'TX';
  if (n === 733) return 'TX';
  if (n >= 300 && n <= 319) return 'GA';
  if (n >= 398 && n <= 399) return 'GA';
  return undefined;
}

export function isLicensedZip(zip: string): boolean {
  return deriveLicensedStateOrUndefined(zip) !== undefined;
}
