// CMS Medicare Beneficiary Identifier (MBI) validator.
//
// 11 characters, positions are strictly typed per CMS spec:
//   C1  num(1-9)         — no leading zero
//   C2  alpha            — no S L O I B Z
//   C3  alphanum         — alpha restrictions apply
//   C4  num
//   C5  alpha
//   C6  alphanum
//   C7  num
//   C8  alpha
//   C9  alpha
//   C10 num
//   C11 num
//
// Callers typically get user input with dashes or spaces (e.g.
// "1EG4-TE5-MK72"); normalizeMbi() strips those and uppercases before
// regex matching.

export const MBI_REGEX =
  /^[1-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY][0-9][0-9]$/;

/** Strips whitespace + dashes and uppercases. Returns empty string on non-string input. */
export function normalizeMbi(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

/** Returns true when the input (after normalization) matches the CMS MBI format. */
export function isValidMbi(raw: unknown): boolean {
  const normalized = normalizeMbi(raw);
  if (normalized.length !== 11) return false;
  return MBI_REGEX.test(normalized);
}
