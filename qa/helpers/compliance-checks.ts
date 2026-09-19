// ---------------------------------------------------------------------------
// compliance-checks.ts — reusable assertions.
//
// Every check returns a CheckResult instead of throwing, so one failure never
// short-circuits the sweep and the operator gets a full punch list in one run.
// Severity distinguishes three different things that all look like "red" in a
// naive harness:
//
//   fail  a disclosure that is required and missing, or text that is wrong
//   warn  something a carrier compliance reviewer will ask about
//   info  recorded for the report, no judgement (the ranking-language rule)
//
// Only `fail` breaks the build. Rob's ruling of 2026-09-17 is that the fit
// score's "Top match" badge is reported and not changed, so it is `info`.
// ---------------------------------------------------------------------------

import type { Page } from '@playwright/test';
import {
  BROKER_PHONE,
  CMS_NOT_REVIEWED,
  CROSS_PRODUCT_REPORTED,
  GI_RIGHTS_PATTERN,
  INTAKE_FORBIDDEN_FIELDS,
  MBI_ALLOWED_ROUTES,
  MBI_FIELD_PATTERN,
  MEDICARE_HOTLINE,
  MIN_BODY_FONT_PX,
  MIN_LANGUAGE_TAGLINES,
  NOT_GOVERNMENT_ENDORSED,
  NPN_IDENTIFIER,
  OUT_OF_SCOPE_HARD,
  PART_D_CARVEOUT_PATTERNS,
  RANKING_LANGUAGE,
  RATE_METHODOLOGY_PATTERNS,
  RATES_ARE_ESTIMATES,
  SECTION_1557_MARKERS,
  TAGLINE_LANG_SELECTOR,
  TTY_PATTERNS,
  UNDERWRITING_PATTERNS,
  UNQUALIFIED_APPOINTMENT_CLAIM,
  UNLICENSED_NOTICE,
  WRONG_BROKER_PHONE,
} from '../fixtures/medigap-rules.js';
import { scanForBannedLanguage } from '../fixtures/banned-language.js';

export type Severity = 'fail' | 'warn' | 'info';

export interface CheckResult {
  rule: string;
  /** False only when the rule was violated. Info rules pass by definition. */
  pass: boolean;
  severity: Severity;
  detail: string;
  data?: unknown;
}

const ok = (rule: string, detail: string, data?: unknown): CheckResult => ({
  rule, pass: true, severity: 'fail', detail, data,
});
const bad = (rule: string, detail: string, severity: Severity = 'fail', data?: unknown): CheckResult => ({
  rule, pass: false, severity, detail, data,
});

export async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '');
}

// ─── Identity ──────────────────────────────────────────────────────────────

export function checkBrokerIdentity(text: string): CheckResult[] {
  const out: CheckResult[] = [];

  out.push(
    NPN_IDENTIFIER.test(text)
      ? ok('Broker NPN identifier', 'NPN #10447418 present')
      : bad('Broker NPN identifier', 'no NPN identifier on this screen — 42 CFR §422.2260 "who is speaking" analogue; a Medigap surface still has to say whose agency it is'),
  );

  const wrong = WRONG_BROKER_PHONE.exec(text);
  out.push(
    wrong
      ? bad('Broker phone number', `transposed phone number on screen: "${wrong[0]}" — must be ${BROKER_PHONE}`)
      : ok('Broker phone number', 'no transposed phone number'),
  );

  return out;
}

// ─── Section 1557 (45 CFR §92.10) ──────────────────────────────────────────

export async function checkSection1557(page: Page, text: string): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const missing = SECTION_1557_MARKERS.filter((m) => !m.pattern.test(text)).map((m) => m.label);

  out.push(
    missing.length === 0
      ? ok('Section 1557 notice', 'nondiscrimination notice, grievance contact and OCR pointer all present')
      : bad('Section 1557 notice', `missing on this screen: ${missing.join(', ')}`, 'fail', missing),
  );

  const taglines = await page.locator(TAGLINE_LANG_SELECTOR).count();
  out.push(
    taglines >= MIN_LANGUAGE_TAGLINES
      ? ok('Language taglines', `${taglines} tagged language taglines`)
      : bad('Language taglines', `${taglines} taglines rendered, expected at least ${MIN_LANGUAGE_TAGLINES} (45 CFR §92.11 top-15)`, 'fail', { taglines }),
  );

  out.push(
    TTY_PATTERNS.some((p) => p.test(text))
      ? ok('TTY number', 'TTY reference present')
      : bad('TTY number', 'a phone number is offered with no TTY alternative'),
  );

  return out;
}

// ─── Universal disclosures ─────────────────────────────────────────────────

export function checkUniversalDisclosures(text: string): CheckResult[] {
  const out: CheckResult[] = [];

  out.push(
    CMS_NOT_REVIEWED.test(text)
      ? ok('CMS-not-reviewed clause', 'present')
      : bad('CMS-not-reviewed clause', 'this surface shows CMS-sourced data without stating CMS has not reviewed or approved it'),
  );

  out.push(
    MEDICARE_HOTLINE.test(text)
      ? ok('1-800-MEDICARE pointer', 'present')
      : bad('1-800-MEDICARE pointer', 'no pointer to Medicare.gov / 1-800-MEDICARE for official plan information'),
  );

  return out;
}

/** Entry screen only — the government-disclaimer placement. */
export function checkNotGovernmentEndorsed(text: string): CheckResult {
  return NOT_GOVERNMENT_ENDORSED.test(text)
    ? ok('Not-government-endorsed disclaimer', 'present on the entry screen')
    : bad('Not-government-endorsed disclaimer', 'entry screen does not state the agency is not connected with or endorsed by the U.S. Government or Medicare');
}

// ─── Marketing language ────────────────────────────────────────────────────

/**
 * Marketing language is a `warn`, not a `fail`.
 *
 * This is a deliberate line, not a loosened rule. The gate blocks on
 * disclosures that are legally required and on anything touching PHI — those
 * have a right answer. Whether a word is a prohibited superlative on a Medigap
 * surface is a judgement call that belongs to Rob, and NAIC §22 is a
 * marketing-standards regime, not a checklist like 45 CFR §92.10. Every hit is
 * printed in the report with its surrounding context so the call can actually
 * be made; nothing is hidden. Raise this to 'fail' once the copy is settled.
 */
export function checkBannedLanguage(text: string): CheckResult {
  const hits = scanForBannedLanguage(text);
  return hits.length === 0
    ? ok('No misleading marketing language', 'no superlatives, urgency or absolute guarantees')
    : bad(
        'No misleading marketing language',
        `${hits.length} hit(s): ${hits.map((h) => `${h.label} → "${h.context}"`).join(' | ')}`,
        'warn',
        hits,
      );
}

/**
 * Ranking language. Reported only — see the ruling in CLAUDE.md. Returns an
 * info result whether or not anything matched, so the report always records
 * the current state of the question rather than going silent when it passes.
 */
export function checkRankingLanguage(text: string): CheckResult {
  const hits = RANKING_LANGUAGE.filter((r) => r.pattern.test(text)).map((r) => r.label);
  return {
    rule: 'Ranking language (reported, not enforced)',
    pass: true,
    severity: 'info',
    detail: hits.length
      ? `present on this screen: ${hits.join(', ')}. MCMG §30.6 would prohibit these on the MA surface; whether they bind a Medigap surface is open — Rob's ruling 2026-09-17 is flag, don't change.`
      : 'none present on this screen',
    data: hits,
  };
}

// ─── Scope ─────────────────────────────────────────────────────────────────

export function checkScope(text: string): CheckResult[] {
  const out: CheckResult[] = [];

  const violations = OUT_OF_SCOPE_HARD.filter((p) => p.pattern.test(text)).map((p) => p.product);
  out.push(
    violations.length === 0
      ? ok('Scope of communication', 'no out-of-scope products')
      : bad('Scope of communication', `markets products outside Medigap: ${violations.join(', ')}`, 'fail', violations),
  );

  for (const cp of CROSS_PRODUCT_REPORTED) {
    if (!cp.pattern.test(text)) continue;
    out.push({
      rule: `Cross-product reference — ${cp.product}`,
      pass: true,
      severity: 'info',
      detail: cp.why,
    });
  }

  return out;
}

// ─── Medigap-specific ──────────────────────────────────────────────────────

/** Run on any screen that displays a premium. NAIC Model Act §13. */
export function checkRateDisclosures(text: string): CheckResult[] {
  const out: CheckResult[] = [];

  const methodologies = RATE_METHODOLOGY_PATTERNS.filter((p) => p.test(text)).length;
  out.push(
    methodologies > 0
      ? ok('Rate-methodology disclosure', `${methodologies} of 3 rate types named`)
      : bad('Rate-methodology disclosure', 'premiums displayed with no attained-age / issue-age / community-rated disclosure (NAIC Model Act §13)'),
  );

  const claim = UNQUALIFIED_APPOINTMENT_CLAIM.exec(text);
  out.push(
    claim
      ? bad('Rate source described accurately', `the screen claims the rates shown are carriers Generation Health is appointed with ("${claim[0]}"), but they are the CMS filings for the state minus the suppression list`)
      : ok('Rate source described accurately', 'no unqualified appointment claim'),
  );

  out.push(
    RATES_ARE_ESTIMATES.test(text)
      ? ok('Rates are estimates', 'present')
      : bad('Rates are estimates', 'premiums shown without stating they are estimates and not a quote'),
  );

  return out;
}

/**
 * Run on any screen showing a qualification score or a premium.
 *
 * `oep` matters: during the 6-month open-enrollment window no medical
 * underwriting applies, so requiring an "underwriting applies" statement on
 * that path would be requiring a false statement. What is required on every
 * path is that a displayed premium is not presented as a guaranteed rate.
 */
export function checkUnderwritingDisclosure(text: string, oep: boolean): CheckResult {
  const [underwritingApplies, notGuaranteed] = UNDERWRITING_PATTERNS;
  const missing: string[] = [];
  if (!oep && !underwritingApplies.test(text)) missing.push('medical-underwriting statement');
  if (!notGuaranteed.test(text)) missing.push('rates/acceptance are not guaranteed');

  return missing.length === 0
    ? ok('Underwriting disclosure', oep
        ? 'OEP path — non-guarantee language present, underwriting statement correctly absent'
        : 'underwriting and non-guarantee language both present')
    : bad('Underwriting disclosure', `missing: ${missing.join(', ')}`);
}

/** Run on /results. 42 CFR §403.205. */
export function checkGiRights(text: string): CheckResult {
  return GI_RIGHTS_PATTERN.test(text)
    ? ok('Guaranteed Issue rights', 'GI rights enumerated')
    : bad('Guaranteed Issue rights', 'rates shown with no Guaranteed Issue rights explainer (42 CFR §403.205)');
}

/** Run on /results. Medigap excludes Part D and must say so. */
export function checkPartDCarveOut(text: string): CheckResult {
  const found = PART_D_CARVEOUT_PATTERNS.filter((p) => p.test(text)).length;
  return found === PART_D_CARVEOUT_PATTERNS.length
    ? ok('Part D carve-out', 'states Medigap excludes drugs and points to standalone Part D')
    : bad('Part D carve-out', 'results shown without the full Medigap-excludes-prescription-drugs disclosure');
}

// ─── Licensure gate ────────────────────────────────────────────────────────

export async function checkUnlicensedGate(page: Page, text: string): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  out.push(
    UNLICENSED_NOTICE.test(text)
      ? ok('Out-of-state notice', 'unlicensed-state notice shown')
      : bad('Out-of-state notice', 'ZIP resolves outside NC/TX/GA but no licensure notice is shown'),
  );

  const continueBtn = page.locator('button.btn', { hasText: /rate projection/i }).first();
  const disabled = (await continueBtn.count()) ? await continueBtn.isDisabled() : null;
  out.push(
    disabled === true
      ? ok('Licensure gate', 'Continue is disabled for an unlicensed ZIP')
      : bad('Licensure gate', disabled === null
          ? 'could not find the Continue button to verify the licensure gate'
          : 'Continue is ENABLED for a ZIP outside NC/TX/GA — the flow would quote an applicant Rob cannot write (NC GS §58-33-26 / TX Ins. §4001.101 / GA OCGA §33-23-4)'),
  );

  out.push(
    MEDICARE_HOTLINE.test(text)
      ? ok('Out-of-state referral', 'referred to 1-800-MEDICARE')
      : bad('Out-of-state referral', 'unlicensed applicant is not referred anywhere'),
  );

  return out;
}

// ─── Typography ────────────────────────────────────────────────────────────

export async function checkFontSize(page: Page): Promise<CheckResult> {
  const result = await page.evaluate((min: number) => {
    const offenders: Array<{ tag: string; text: string; px: number }> = [];
    let smallestPx = Infinity;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (el.textContent ?? '').trim();
      if (text.length < 4) continue;
      if (el.children.length > 0 && Array.from(el.children).some((c) => (c.textContent ?? '').trim().length > 4)) continue;
      const px = parseFloat(style.fontSize);
      if (!Number.isFinite(px)) continue;
      if (px < smallestPx) smallestPx = px;
      if (px < min) offenders.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 60), px });
    }
    return { smallestPx: Number.isFinite(smallestPx) ? smallestPx : null, offenders: offenders.slice(0, 25) };
  }, MIN_BODY_FONT_PX);

  const px = result.smallestPx;
  if (px == null) return ok(`Font size ≥ ${MIN_BODY_FONT_PX}px`, 'no text elements found');
  // `warn`: CMS sets a 12pt floor for printed MA marketing, but there is no
  // binding minimum for a Medigap web surface. Small type on a screen built
  // for 65-year-olds is still worth seeing in the report every run.
  return px >= MIN_BODY_FONT_PX
    ? ok(`Font size ≥ ${MIN_BODY_FONT_PX}px`, `smallest visible font ${px}px`)
    : bad(`Font size ≥ ${MIN_BODY_FONT_PX}px`, `${result.offenders.length} element(s) below ${MIN_BODY_FONT_PX}px — smallest ${px}px`, 'warn', result);
}

// ─── PHI ───────────────────────────────────────────────────────────────────

/**
 * SSN / Medicaid ID must never be collected. The MBI is legitimate on /apply
 * and nowhere else — this is the check that would catch it drifting earlier
 * into the funnel, where it would be collected before the applicant has
 * consented to anything.
 */
export async function checkIntakeFieldSafety(page: Page, route: string): Promise<CheckResult[]> {
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea, select')).map((el) => ({
      name: el.getAttribute('name') ?? '',
      placeholder: el.getAttribute('placeholder') ?? '',
      label: el.getAttribute('aria-label') ?? '',
      id: el.getAttribute('id') ?? '',
      autocomplete: el.getAttribute('autocomplete') ?? '',
    })),
  );

  const out: CheckResult[] = [];
  const haystacks = inputs.map((i) => `${i.name} ${i.placeholder} ${i.label} ${i.id} ${i.autocomplete}`.trim());

  const forbidden = haystacks.filter((h) => INTAKE_FORBIDDEN_FIELDS.some((p) => p.test(h)));
  out.push(
    forbidden.length === 0
      ? ok('No SSN / Medicaid ID collected', `${inputs.length} input(s), none PHI-forbidden`)
      : bad('No SSN / Medicaid ID collected', `forbidden inputs: ${forbidden.join(' | ')}`, 'fail', forbidden),
  );

  const mbiFields = haystacks.filter((h) => MBI_FIELD_PATTERN.test(h));
  if (mbiFields.length) {
    const allowed = MBI_ALLOWED_ROUTES.some((r) => route.startsWith(r));
    out.push(
      allowed
        ? ok('MBI collected only on /apply', `MBI input present on ${route}, which is the application screen`)
        : bad('MBI collected only on /apply', `MBI input on ${route} — the MBI belongs on /apply only, after the applicant has seen the authorizations`, 'fail', mbiFields),
    );
  }

  return out;
}

/**
 * Scans the URL, the rendered text and the DOM for leaked identifiers.
 *
 * `route` matters for one pattern only. An MBI in the page content is a
 * finding everywhere EXCEPT the application screen, where the applicant is
 * deliberately typing one into a form — flagging it there would report the
 * product working as designed. The URL check stays absolute: an MBI, SSN,
 * email, phone or DOB in a query string is a finding on every route,
 * /apply included, because that is what ends up in browser history, in
 * referrer headers and in server logs.
 */
export async function checkPhiExposure(page: Page, text: string, route = ''): Promise<CheckResult> {
  const url = page.url();
  const html = await page.content();

  const mbi = /\b[0-9][A-Z][A-Z0-9]{2}-[A-Z0-9]{3}-[A-Z0-9]{4}\b/g;
  const ssn = /\b\d{3}-\d{2}-\d{4}\b/g;
  const emailInQs = /[?&][^=&]*=[^&]*@[^&]+\.[a-z]{2,}/i;
  const phoneInQs = /[?&][^=&]*=(?:\+?1)?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const dobInQs = /[?&](dob|birth|bday)[^=]*=/i;

  const findings: string[] = [];
  const mbiAllowedHere = MBI_ALLOWED_ROUTES.some((r) => route.startsWith(r));
  if (!mbiAllowedHere && ([...text.matchAll(mbi)].length || [...html.matchAll(mbi)].length)) {
    findings.push('MBI pattern in page content');
  }
  if ([...text.matchAll(ssn)].length || [...html.matchAll(ssn)].length) findings.push('SSN-like pattern in page content');
  if (emailInQs.test(url)) findings.push('email in URL query string');
  if (phoneInQs.test(url)) findings.push('phone number in URL query string');
  if (dobInQs.test(url)) findings.push('date of birth in URL query string');

  return findings.length === 0
    ? ok('PHI exposure', 'no identifiers in the URL or page content')
    : bad('PHI exposure', findings.join('; '), 'fail', findings);
}

// ─── Aggregate ─────────────────────────────────────────────────────────────

/** The rules that apply to every screen in the flow. */
export async function runGlobalRules(page: Page, route: string): Promise<CheckResult[]> {
  const text = await pageText(page);
  return [
    ...checkBrokerIdentity(text),
    ...(await checkSection1557(page, text)),
    ...checkUniversalDisclosures(text),
    checkBannedLanguage(text),
    checkRankingLanguage(text),
    ...checkScope(text),
    await checkFontSize(page),
    ...(await checkIntakeFieldSafety(page, route)),
    await checkPhiExposure(page, text, route),
  ];
}

export interface Summary {
  total: number;
  failed: number;
  warned: number;
  info: number;
  passed: number;
}

export function summarize(results: CheckResult[]): Summary {
  const failed = results.filter((r) => !r.pass && r.severity === 'fail').length;
  const warned = results.filter((r) => !r.pass && r.severity === 'warn').length;
  const info = results.filter((r) => r.severity === 'info').length;
  return { total: results.length, failed, warned, info, passed: results.length - failed - warned };
}

// ─── /apply — TCPA, consent mechanics, PHI ─────────────────────────────────
//
// 47 CFR §64.1200(f)(9), the FCC One-to-One Consent rule effective 2025-01-27,
// requires prior express written consent to be obtained "separately and
// conspicuously". The failure mode it exists to prevent is a single composite
// click that bundles marketing consent in with the authorizations a consumer
// has to accept to get the product at all. These checks assert the separation
// is real in the DOM, not just visual.

export interface TcpaEvidence {
  carrierAuthCount: number;
  tcpaRowCount: number;
  tcpaHeadingPresent: boolean;
  notAConditionPresent: boolean;
  optOutPresent: boolean;
  /** Timestamp line visible after the TCPA box is ticked. */
  timestampAfterTcpa: boolean;
  /** Timestamp line visible after ONLY the carrier auths are ticked. */
  timestampAfterCarrierAuthsOnly: boolean;
  submitEnabledBeforeConsent: boolean;
}

export function checkTcpaSeparation(e: TcpaEvidence): CheckResult[] {
  const out: CheckResult[] = [];

  out.push(
    e.tcpaRowCount === 1 && e.carrierAuthCount >= 1
      ? ok('TCPA consent is its own control', `${e.carrierAuthCount} carrier authorization(s) plus 1 separate TCPA control`)
      : bad('TCPA consent is its own control', `expected 1 TCPA control separate from the carrier authorizations, found ${e.tcpaRowCount} TCPA and ${e.carrierAuthCount} carrier rows — a bundled consent is exactly what 47 CFR §64.1200(f)(9) prohibits`),
  );

  out.push(
    e.tcpaHeadingPresent
      ? ok('TCPA consent is conspicuously identified', 'has its own heading')
      : bad('TCPA consent is conspicuously identified', 'no distinct TCPA heading — consent must be conspicuously identified, not folded into the authorization list'),
  );

  out.push(
    e.notAConditionPresent
      ? ok('TCPA not a condition of purchase', 'stated')
      : bad('TCPA not a condition of purchase', 'consent is collected without stating it is not a condition of purchase'),
  );

  out.push(
    e.optOutPresent
      ? ok('TCPA opt-out disclosure', 'STOP / HELP and message-rate language present')
      : bad('TCPA opt-out disclosure', 'no STOP/HELP opt-out or message-and-data-rates language'),
  );

  // The burden-of-proof evidence: consent has to be timestamped, and only the
  // TCPA toggle may produce it.
  out.push(
    e.timestampAfterTcpa
      ? ok('TCPA consent is timestamped', 'a consent timestamp appears once the TCPA box is ticked')
      : bad('TCPA consent is timestamped', 'ticking TCPA consent records no visible timestamp — this is the burden-of-proof evidence if the consent is ever challenged'),
  );

  out.push(
    !e.timestampAfterCarrierAuthsOnly
      ? ok('Carrier authorizations do not imply TCPA consent', 'ticking the carrier authorizations alone stamps nothing')
      : bad('Carrier authorizations do not imply TCPA consent', 'a consent timestamp appeared after ticking only the carrier authorizations — accepting the authorizations is being construed as TCPA consent'),
  );

  out.push(
    !e.submitEnabledBeforeConsent
      ? ok('Submit gated on full consent', 'submit stays disabled until every authorization, TCPA consent and the signature are complete')
      : bad('Submit gated on full consent', 'the application could be submitted before consent and signature were complete'),
  );

  return out;
}

/**
 * What actually left the browser. The submission legitimately carries the
 * applicant's details; the analytics beacon must not, and neither may the URL.
 */
export function checkSubmissionPayload(enrollBodies: unknown[], analyticsBodies: unknown[], url: string): CheckResult[] {
  const out: CheckResult[] = [];
  const enroll = JSON.stringify(enrollBodies);
  const beacon = JSON.stringify(analyticsBodies);

  out.push(
    enrollBodies.length > 0
      ? ok('Application submitted', `${enrollBodies.length} submission POST captured`)
      : bad('Application submitted', 'no submission POST was made — the flow did not complete'),
  );

  // The consent timestamp has to travel with the submission, or the record of
  // it exists only in a browser tab that is about to close.
  out.push(
    /tcpaConsentAt|tcpa_consent_at/i.test(enroll)
      ? ok('Consent timestamp reaches the server', 'tcpaConsentAt present in the submission')
      : bad('Consent timestamp reaches the server', 'the submission carries no TCPA consent timestamp — the only proof of consent would be in the closed browser tab'),
  );

  const beaconLeaks = [
    ['MBI', /\b[0-9][A-Z][A-Z0-9]{2}-?[A-Z0-9]{3}-?[A-Z0-9]{4}\b/],
    ['name', /"(firstName|lastName)"/i],
    ['email', /[\w.+-]+@[\w-]+\.[a-z]{2,}/i],
    ['phone', /"phone"|\b\d{10}\b/],
    ['date of birth', /"dob"|"birth/i],
    ['security PIN', /"securityPin"/i],
  ].filter(([, rx]) => (rx as RegExp).test(beacon)).map(([label]) => label as string);

  out.push(
    beaconLeaks.length === 0
      ? ok('Analytics beacon carries no applicant data', `${analyticsBodies.length} beacon event(s), none carrying an identifier`)
      : bad('Analytics beacon carries no applicant data', `the funnel beacon posted: ${beaconLeaks.join(', ')}`, 'fail', analyticsBodies),
  );

  out.push(
    !/[?&]/.test(url) || !/mbi|ssn|dob|email|phone|pin/i.test(url)
      ? ok('No applicant data in the URL', 'submission URL carries no identifiers')
      : bad('No applicant data in the URL', `identifiers in the URL: ${url}`),
  );

  return out;
}
