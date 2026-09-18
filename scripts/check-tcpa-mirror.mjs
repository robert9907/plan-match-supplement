#!/usr/bin/env node
/**
 * Build gate: api/_lib/tcpa-consent.ts must stay byte-identical to
 * src/lib/tcpa-consent.ts below the MIRROR-BOUNDARY line.
 *
 * The two files exist because nothing under api/ imports from src/ in
 * this repo (see the header in the mirror). The consent RECORD is built
 * from the api/ copy while the consumer READS the src/ copy, so any
 * drift between them means the stored consent_text describes language
 * that was never on screen — which is precisely the evidentiary failure
 * the versioned-constant design exists to prevent.
 *
 * Wired into `npm run build`, so drift fails the deploy.
 */
import { readFileSync } from 'node:fs';

const CANONICAL = 'src/lib/tcpa-consent.ts';
const MIRROR = 'api/_lib/tcpa-consent.ts';
const MARKER = 'MIRROR-BOUNDARY';

/** Everything after the line containing MARKER. Throws if absent, so a
 *  deleted boundary can't silently turn the check into a no-op. */
function bodyOf(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => l.includes(MARKER));
  if (idx === -1) {
    throw new Error(`${path}: no ${MARKER} line — the mirror check cannot run.`);
  }
  return lines.slice(idx + 1).join('\n');
}

let canonical;
let mirror;
try {
  canonical = bodyOf(CANONICAL);
  mirror = bodyOf(MIRROR);
} catch (err) {
  console.error(`\n[check-tcpa-mirror] ${err.message}\n`);
  process.exit(1);
}

/**
 * Second gate: the component must RENDER the constants, not restate
 * them. Re-inlining the sentence would leave both files in agreement
 * with each other and in disagreement with the screen — the one drift
 * the byte comparison above cannot see.
 */
const COMPONENT = 'src/components/Application.tsx';
const component = readFileSync(COMPONENT, 'utf8');
const REINLINED = [
  'I expressly consent to be contacted by',
  'Reply STOP to opt out',
  'Not a condition of purchase',
];
const found = REINLINED.filter((phrase) => component.includes(phrase));
if (found.length > 0) {
  console.error(`
[check-tcpa-mirror] Consent language is hard-coded in ${COMPONENT}.

Found literal: ${JSON.stringify(found[0])}

The consent record stores the constants from ${CANONICAL}. A sentence
typed into the component renders to the consumer while the record keeps
describing the constant — so the stored consent_text becomes evidence of
language nobody was shown, with nothing to flag it.

Fix: render TCPA_CONSENT_PREAMBLE / _DISCLOSURE_PREFIX / _SELLER /
_DISCLOSURE_SUFFIX from ${CANONICAL} instead of the literal.
`);
  process.exit(1);
}

if (canonical === mirror) {
  process.exit(0);
}

// Report the first differing line so the fix is obvious rather than a
// diff hunt through 130 lines of identical-looking constants.
const a = canonical.split('\n');
const b = mirror.split('\n');
let i = 0;
while (i < a.length && i < b.length && a[i] === b[i]) i += 1;

console.error(`
[check-tcpa-mirror] TCPA consent language has DRIFTED.

  canonical: ${CANONICAL}
  mirror:    ${MIRROR}

First difference, at body line ${i + 1}:

  canonical: ${JSON.stringify(a[i] ?? '<end of file>')}
  mirror:    ${JSON.stringify(b[i] ?? '<end of file>')}

The mirror is what builds every consent record; the canonical is what
the consumer reads on screen. While these differ, consent_text is
evidence of language nobody was shown.

Fix: edit ${CANONICAL}, then copy it below the ${MARKER}
line of ${MIRROR}. Never the other way round. If the
wording itself changed, bump TCPA_CONSENT_VERSION in the same edit.
`);
process.exit(1);
