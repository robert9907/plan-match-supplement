/*!
 * LOCAL MIRROR of src/lib/tcpa-consent.ts.
 *
 * Nothing under api/ imports from src/ in this repo, and the serverless
 * functions are built by @vercel/node rather than by the Vite/tsc build
 * that owns src/ (tsconfig.json includes only "src"). Reaching across
 * that boundary for the first time on the enrollment endpoint — during
 * AEP — trades a provable drift risk for an unprovable build risk. The
 * copy is the smaller, louder failure.
 *
 * The copy IS the risk: a disclosure that drifts from the one on screen
 * makes every consent record written afterwards a lie about what the
 * consumer read. scripts/check-tcpa-mirror.mjs asserts the two files are
 * byte-identical below the boundary line and runs as part of
 * `npm run build`, so drift fails the deploy rather than surfacing at
 * audit time.
 *
 * Edit src/lib/tcpa-consent.ts and copy it here. Never the other way.
 *
 * MIRROR-BOUNDARY — everything below this line is compared byte-for-byte.
 */

/*!
 * The TCPA consent disclosure for Plan Match Supplement, as one set of
 * versioned constants.
 *
 * WHY THIS IS NOT JUST A STRING IN THE COMPONENT
 *
 * The disclosure lived only in Application.tsx, so the consent RECORD
 * could never say what the consumer actually read. What got stored was
 * `authChecks` — a positional array of bare booleans — and `signedAt`.
 * Under the FCC One-to-One Consent rule (effective 2025-01-27) the
 * evidence questions are who consented, when, from what device, and TO
 * WHAT. Only the first two had an answer in the data, and the fourth
 * had none at all.
 *
 * Keeping the text here and rendering it from here means the record and
 * the screen cannot drift: there is one string, and the record stores
 * the version alongside it. If the wording changes, bump the version —
 * old records keep pointing at the language that was actually shown,
 * which is the whole point of an audit trail.
 *
 * DO NOT edit any DISCLOSURE constant without bumping
 * TCPA_CONSENT_VERSION. A changed string under an unchanged version is
 * a record that lies about what was on screen.
 */

/** Bump on ANY wording change below. Stored on every consent record. */
export const TCPA_CONSENT_VERSION = '2026-09-12.1';

/**
 * The seller, split out because Application.tsx renders it inside
 * <strong> while the record needs it inline. Composing the full string
 * from the same three parts is what lets the mirror check prove the
 * rendered text and the stored text are the same sentence.
 */
export const TCPA_CONSENT_SELLER = 'Rob Simm / GenerationHealth.me (NPN #10447418)';

export const TCPA_CONSENT_DISCLOSURE_PREFIX = 'I expressly consent to be contacted by ';

export const TCPA_CONSENT_DISCLOSURE_SUFFIX =
  ' regarding Medicare Supplement insurance options via autodialed and/or ' +
  'prerecorded calls, text messages, and email at the contact information I ' +
  'have provided. Msg frequency varies. Msg & data rates may apply. ' +
  'Reply STOP to opt out, HELP for help.';

/** The checkbox body, exactly as rendered. */
export const TCPA_CONSENT_DISCLOSURE =
  TCPA_CONSENT_DISCLOSURE_PREFIX + TCPA_CONSENT_SELLER + TCPA_CONSENT_DISCLOSURE_SUFFIX;

/**
 * The sub-text above the checkbox. Carries the not-a-condition-of-
 * purchase element, which the FCC rule expects to see, so it belongs in
 * the stored record even though it sits outside the checkbox label.
 */
export const TCPA_CONSENT_PREAMBLE =
  'Required separately by the FCC One-to-One Consent rule. Not a condition of purchase.';

/** Everything the consumer read in the consent block, in reading order. */
export const TCPA_CONSENT_TEXT = `${TCPA_CONSENT_PREAMBLE} ${TCPA_CONSENT_DISCLOSURE}`;

/**
 * How the consent was obtained. Recorded so the question "on what basis
 * did you dial this person" has an answer in the data rather than in
 * someone's memory.
 *
 *   prior_express_written_consent
 *     The consumer ticked the TCPA box — authChecks[4] on a 5-tuple
 *     submission — and the timestamp, IP and user-agent were captured
 *     at the same moment.
 *
 *   inbound_initiated
 *     The consumer contacted us first and the message answers that
 *     contact. Weaker, and NOT a basis for marketing — present so a
 *     path that genuinely has only this cannot quietly borrow the
 *     stronger label.
 */
export type TcpaConsentBasis = 'prior_express_written_consent' | 'inbound_initiated';

/** The consent record shape. Deliberately identical to what
 *  plan-match/api/enroll.ts and AgentBase's /api/sms-lead-intake write
 *  to leads.context.tcpa_consent, so ONE audit query answers the
 *  question across every lead source. */
export interface TcpaConsentRecord {
  consent_text: string;
  consent_version: string;
  consent_basis: TcpaConsentBasis;
  consent_at: string | null;
  consent_ip: string | null;
  consent_user_agent: string | null;
  consent_source: string;
  captured_at: string;
}

/** Build the record from what the enrollment payload captured. */
export function buildTcpaConsentRecord(args: {
  tcpaAt?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  source: string;
  basis?: TcpaConsentBasis;
}): TcpaConsentRecord {
  return {
    consent_text: TCPA_CONSENT_TEXT,
    consent_version: TCPA_CONSENT_VERSION,
    consent_basis: args.basis ?? 'prior_express_written_consent',
    consent_at: args.tcpaAt ?? null,
    consent_ip: args.ip ?? null,
    consent_user_agent: args.userAgent ?? null,
    consent_source: args.source,
    captured_at: new Date().toISOString(),
  };
}

/**
 * True only when the submission carried the separate TCPA checkbox.
 *
 * `validate()` accepts a 4-tuple for back-compat with clients cached
 * from before the W2 Fix 4 deploy (last such submission: 2026-06-19).
 * Those submissions carry NO TCPA consent, and the application is still
 * accepted — losing a real applicant's supplement paperwork is worse
 * than having to reach them by a channel that doesn't need express
 * written consent. What must not happen is the record implying a
 * consent that was never given, so this is the one gate on writing a
 * consent record at all.
 */
export function hasTcpaConsentCheck(authChecks: unknown): boolean {
  return Array.isArray(authChecks) && authChecks.length === 5 && authChecks[4] === true;
}
