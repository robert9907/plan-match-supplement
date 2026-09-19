// ---------------------------------------------------------------------------
// medigap-rules.ts — the rule constants this harness asserts against.
//
// Medicare Supplement is NOT governed by the CMS Medicare Communications and
// Marketing Guidelines the way MA/PDP is. The applicable regimes here are:
//
//   NAIC Medicare Supplement Insurance Minimum Standards Model Act
//     §13  rate-methodology disclosure wherever a premium is displayed
//     §22  marketing standards (no misleading comparisons, no high pressure)
//   42 CFR §403.205          Guaranteed Issue rights
//   45 CFR §92.10            Section 1557 nondiscrimination notice + taglines
//   47 CFR §64.1200(f)(9)    FCC One-to-One Consent, eff. 2025-01-27
//   NC GS §58-33-26 / TX Ins. §4001.101 / GA OCGA §33-23-4   producer licensure
//
// The TPMO disclaimer (42 CFR §422.2267(e)(41)) is deliberately absent from
// this file. It governs MA/PDP and does not belong on a Medigap surface.
// ---------------------------------------------------------------------------

/** Rob's producer identity. In NC the state licence number IS the NPN. */
export const BROKER_NPN = '10447418';
export const BROKER_PHONE = '(828) 761-3326';

/**
 * The transposed number that has shown up in copy before. Any occurrence is a
 * hard failure — a consumer who dials it does not reach the agent of record.
 */
export const WRONG_BROKER_PHONE = /\(?828\)?[\s.\-–—]*761[\s.\-–—]*3324\b/;

export const NPN_IDENTIFIER = /NPN\s*#?\s*10447418\b/i;

/** Smallest computed font-size, in px, allowed on visible body text. */
export const MIN_BODY_FONT_PX = 12;

// ─── Section 1557 (45 CFR §92.10) ──────────────────────────────────────────
// Rendered by NondiscriminationFooter inside Frame, so it must be present on
// every screen of the flow, not just the landing page.

export const SECTION_1557_MARKERS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'nondiscrimination heading', pattern: /Nondiscrimination Notice/i },
  { label: 'civil-rights compliance clause', pattern: /complies with applicable Federal civil rights laws/i },
  { label: 'grievance contact', pattern: /file a grievance with/i },
  { label: 'HHS OCR complaint portal', pattern: /ocrportal\.hhs\.gov/i },
  { label: 'language-assistance tagline header', pattern: /Language assistance services, free of charge/i },
];

/** §92.11 expects the top-15 languages in the state. The app ships 15. */
export const MIN_LANGUAGE_TAGLINES = 15;

/** Marked up with lang="xx" by NondiscriminationFooter. */
export const TAGLINE_LANG_SELECTOR = 'p[lang]';

// ─── Universal disclosures ─────────────────────────────────────────────────

export const CMS_NOT_REVIEWED =
  /have not been reviewed or approved by\s+CMS or any Medicare plan/i;

export const MEDICARE_HOTLINE = /1-800-MEDICARE\s*\(1-800-633-4227\)/i;

/** TTY must appear wherever a phone number is offered. Either form counts. */
export const TTY_PATTERNS = [/TTY[^.]{0,20}1-877-486-2048/i, /TTY[^.]{0,20}711/i];

export const NOT_GOVERNMENT_ENDORSED =
  /Not connected with or endorsed by the U\.S\.\s*Government or Medicare/i;

// ─── Medigap-specific disclosures ──────────────────────────────────────────

/**
 * NAIC §13. Required wherever a Medigap premium is displayed. The app states
 * all three methodologies on /rates and labels the per-carrier type on
 * /results.
 */
export const RATE_METHODOLOGY_PATTERNS = [
  /attained[\s-]?age/i,
  /issue[\s-]?age/i,
  /community[\s-]?rated/i,
];

/**
 * Underwriting must be disclosed wherever a qualification score or a premium
 * appears. Acceptance is the carrier's decision, not the agent's.
 */
export const UNDERWRITING_PATTERNS = [
  // Any phrasing that tells the consumer the carrier decides, not the agent.
  // "determined by each carrier's underwriting department" on /results is the
  // app's actual wording and satisfies this as squarely as "underwriting
  // applies" does — the test is whether the disclosure is made, not whether a
  // particular sentence was used.
  /medical underwriting|subject to underwriting|underwriting applies|underwriting (department|guidelines)|health questions/i,
  // The second alternative catches the app's actual phrasing on /rates —
  // "are not a quote or a guarantee of coverage" — which the narrower
  // "not a guarantee" form misses because of the intervening "quote or a".
  /not a guarantee|guarantee of coverage|are not guarantees?|not guaranteed|not a quote/i,
];

/** 42 CFR §403.205 — GI rights enumerated on the screen showing rates. */
export const GI_RIGHTS_PATTERN = /Guaranteed Issue|guaranteed issue/;

/**
 * Medigap does not include Part D. Saying so is a REQUIRED disclosure, which
 * is why the scope rule below treats a PDP mention as allowed rather than as
 * an out-of-scope product reference.
 */
export const PART_D_CARVEOUT_PATTERNS = [
  /do not cover prescription drugs|does not cover prescription drugs/i,
  /separate standalone Part D|standalone Part D prescription drug plan/i,
];

/**
 * A regression guard, not a disclosure requirement.
 *
 * Until 2026-09-19 both /rates and /results said the rates shown were "from
 * carriers Generation Health is appointed with". They are not — they are the
 * CMS Plan Finder filings for the state, filtered only by the three-carrier
 * suppression list: 34 of 38 filed companies in NC against 15 actual
 * appointments. A consumer could pick a carrier believing Rob was their agent
 * for it and find he could not submit the application.
 *
 * If the product ever does filter to appointments, delete this rule — but
 * change the data first and the copy second, never the other way round.
 */
export const UNQUALIFIED_APPOINTMENT_CLAIM =
  /(rates|carriers|plans)[^.]{0,60}(Generation Health|we)\s+(is|are|am)\s+appointed with/i;

/** Rates are estimates, never a quote. */
export const RATES_ARE_ESTIMATES =
  /estimates|not a quote|are not a quote|Rates are estimates/i;

// ─── Licensure ─────────────────────────────────────────────────────────────

export const LICENSED_STATES = ['NC', 'TX', 'GA'] as const;

/** Shown when the ZIP resolves outside NC/TX/GA. Continue must stay disabled. */
export const UNLICENSED_NOTICE =
  /not licensed in your state|licensed to help Medicare Supplement applicants in North Carolina, Texas,\s*and Georgia/i;

// ─── Intake safety ─────────────────────────────────────────────────────────

/**
 * Fields that must never appear on an intake form on this surface.
 *
 * NOTE: the MBI is deliberately NOT on this list. Unlike the MA consumer
 * widget, the Supplement flow submits a real carrier application, and the MBI
 * is a required field on it. It is collected only on /apply, encrypted at rest
 * (migration 004) and masked in the CRM bridge. What this rule enforces is
 * that the MBI never appears BEFORE /apply, and that SSN / Medicaid ID are
 * never collected at all — see checkIntakeFieldSafety.
 */
export const INTAKE_FORBIDDEN_FIELDS = [
  /\bssn\b/i,
  /social[\s_-]?security/i,
  /medicaid[\s_-]?(id|number)/i,
  /\btax[\s_-]?id\b/i,
];

export const MBI_FIELD_PATTERN = /\bmbi\b|medicare[\s_-]?(beneficiary[\s_-]?)?(id|number)/i;

/** Routes on which an MBI input is legitimate. Anywhere else is a finding. */
export const MBI_ALLOWED_ROUTES = ['/apply'];

// ─── Scope of communication ────────────────────────────────────────────────
//
// Two tiers. A hard-fail product has no business on a Medigap surface at all.
// A cross-product reference is allowed but reported, because a carrier
// compliance reviewer will ask about it and Rob should not be surprised.

export const OUT_OF_SCOPE_HARD: Array<{ product: string; pattern: RegExp }> = [
  { product: 'Life insurance', pattern: /\bwhole life\b|\bterm life\b|\blife insurance\b/i },
  { product: 'Annuity', pattern: /\bannuit(y|ies)\b/i },
  { product: 'ACA / Marketplace', pattern: /\bAffordable Care Act\b|\bHealth Insurance Marketplace\b|\bACA subsidy\b/i },
  { product: 'Final expense', pattern: /\bfinal expense\b|\bburial insurance\b/i },
];

export const CROSS_PRODUCT_REPORTED: Array<{ product: string; pattern: RegExp; why: string }> = [
  {
    product: 'Part D (PDP)',
    pattern: /\bPart D\b/i,
    why: 'Required carve-out disclosure — Medigap does not cover prescription drugs.',
  },
  {
    product: 'Medicare Advantage',
    pattern: /\bMedicare Advantage\b|\bMA[- ]?PD\b/i,
    why: 'Deliberate cross-sell on /about and /results. Allowed, but a carrier reviewer will ask whether a scope-of-appointment is required before MA is marketed to a Medigap prospect.',
  },
];

// ─── Ranking language ──────────────────────────────────────────────────────
//
// Reported, never failed. Rob's ruling 2026-09-17: flag, don't change. These
// phrasings would be MCMG §30.6 violations on the MA surface; whether they
// bind a Medigap surface is the open question this report exists to inform.

export const RANKING_LANGUAGE: Array<{ label: string; pattern: RegExp }> = [
  { label: '"top match"', pattern: /\btop\s+match\b/i },
  { label: '"top pick"', pattern: /\btop[\s-]?pick\b/i },
  { label: '"best plan for you"', pattern: /\bbest\s+plan\s+for\s+you\b/i },
  { label: '"recommended plan"', pattern: /\brecommended\s+plan\b/i },
  { label: '"#1 match"', pattern: /#\s?1\s+match\b/i },
  { label: '"our recommendation"', pattern: /\bour\s+recommendation\b/i },
  { label: '"best rate"', pattern: /\bbest\s+rate\b(?!\s+class)/i },
  // Live on /results: "Ranked 1 of 24 carriers based on your profile".
  { label: '"Ranked N of M"', pattern: /\branked\s+\d+\s+of\s+\d+\b/i },
  { label: '"lowest ... premium in your area"', pattern: /\blowest\s+plan\s+[a-z]\s+premium\b/i },
];
