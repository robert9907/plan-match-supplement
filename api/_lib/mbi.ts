// MBI validator for Vercel functions.
//
// Deliberate duplicate of apps/web/src/lib/mbiValidation.ts — the api/
// bundle can't import from the web workspace (broke serverless bundling
// on commit 2363495; see scan-label.ts header). The CMS character-class
// spec doesn't change, so a frozen second copy is acceptable. Keep the
// two in sync on any future regex edit.

// 11 chars, positions strictly typed per CMS spec:
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
export const MBI_REGEX =
  /^[1-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY][0-9][0-9]$/;

/** Strip whitespace + dashes and uppercase. Returns empty string on non-string input. */
export function normalizeMbi(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\s-]/g, '').toUpperCase();
}
