// ---------------------------------------------------------------------------
// medigap-compliance.spec.ts — the Supplement compliance sweep.
//
// One test per persona. Each walks the funnel, runs the global rule set on
// every screen plus the screen-specific rules, and writes its findings to a
// per-persona fragment. global-teardown merges the fragments into one JSON and
// one Markdown punch list covering every persona, including the ones that
// crashed part-way — a flow that breaks at /health still reports everything
// found on the four screens before it.
//
// The test fails on `fail`-severity findings only. `warn` and `info` are
// recorded and printed but never break the build — see the severity note in
// helpers/compliance-checks.ts.
// ---------------------------------------------------------------------------

import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PERSONAS, personasFromEnv, type Persona } from '../fixtures/personas.js';
import { installApiMocks, type RequestLog } from '../helpers/api-mock.js';
import {
  checkGiRights,
  checkNotGovernmentEndorsed,
  checkPartDCarveOut,
  checkRateDisclosures,
  checkUnderwritingDisclosure,
  checkSubmissionPayload,
  checkTcpaSeparation,
  checkUnlicensedGate,
  pageText,
  runGlobalRules,
  summarize,
  type CheckResult,
} from '../helpers/compliance-checks.js';
import {
  blockedState,
  carrierAuthRows,
  continueFromDetails,
  continueFromReview,
  driveToResults,
  enterApply,
  fillApplyDetails,
  sign,
  submitApplication,
  tcpaRow,
  tickCarrierAuths,
  tickTcpa,
  type ScreenName,
} from '../helpers/flow-driver.js';

import { FRAGMENT_DIR, type Finding } from '../helpers/report.js';

// Findings are written to a per-persona fragment as each test ends, and the
// global teardown merges them. They are NOT accumulated in a module-level
// array across tests: Playwright restarts the worker after a failure, which
// resets module state and silently empties the report — the run that
// discovered this produced a green-looking "0 checks" summary while three
// personas were actually failing.
const findings: Finding[] = [];

function record(persona: Persona, screen: string, results: CheckResult[]): void {
  for (const r of results) findings.push({ ...r, persona: persona.id, screen });
}

async function flush(fragment: string): Promise<void> {
  await fs.mkdir(FRAGMENT_DIR, { recursive: true });
  // The /apply test records under one persona but is its own fragment, so it
  // writes everything it collected rather than filtering by persona id.
  const mine = fragment === 'apply' ? findings : findings.filter((f) => f.persona === fragment);
  await fs.writeFile(path.join(FRAGMENT_DIR, `${fragment}.json`), JSON.stringify(mine, null, 2));
}

// Deliberately NOT serial. A compliance sweep exists to produce a full punch
// list in one pass; serial mode would skip every remaining persona after the
// first failure and hide findings on the paths that were never walked.
// `workers: 1` in the config keeps the shared findings list coherent.
test.describe('Medigap compliance sweep', () => {
  test.beforeEach(() => {
    findings.length = 0;
  });

  for (const persona of personasFromEnv()) {
    test(`${persona.id} — ${persona.label}`, async ({ page, baseURL }) => {
      test.setTimeout(180_000);
      const log: RequestLog = await installApiMocks(page, persona);

      try {
        await driveToResults(page, persona, baseURL!, async (screen: ScreenName, route: string) => {
          record(persona, screen, await runGlobalRules(page, route));
        const text = await pageText(page);

        if (screen === 'about') {
          record(persona, screen, [checkNotGovernmentEndorsed(text)]);
          // Keyed on `state === null`, not on reachesResults: the TX persona
          // also stops short, but it stops at a data gap, not at the licence
          // gate, and asserting the out-of-state notice there would be wrong.
          if (persona.state === null) {
            record(persona, screen, await checkUnlicensedGate(page, text));
          }
        }

        // NAIC §13 attaches to a DISPLAYED premium. Scope the rate and
        // underwriting disclosures to screens that actually show a dollar
        // figure — on the TX path the widget never renders one, and demanding
        // a rate disclosure where there is no rate would be noise.
        const showsPremium = /\$\s?\d/.test(text);
        if ((screen === 'rates' || screen === 'results') && showsPremium) {
          record(persona, screen, checkRateDisclosures(text));
          record(persona, screen, [checkUnderwritingDisclosure(text, persona.oep)]);
        }

        if (screen === 'results') {
          record(persona, screen, [checkGiRights(text), checkPartDCarveOut(text)]);
        }
        });
      } catch (err) {
        // A broken flow is itself a finding. Record it, keep everything found
        // on the screens already walked, and let the fragment be written.
        record(persona, 'flow', [{
          rule: 'Flow completes',
          pass: false,
          severity: 'fail',
          detail: `the funnel could not be walked to the end: ${(err as Error).message.split('\n')[0]}`,
        }]);
      }

      // A persona with a documented gap must be stopped in words, not left on
      // a spinner, and must not be shown a premium it cannot honour.
      if (persona.blockedAt) {
        const { url, message } = await blockedState(page);
        record(persona, persona.blockedAt, [
          message
            ? { rule: 'Documented gap is explained to the applicant', pass: true, severity: 'fail', detail: `stopped at ${persona.blockedAt} with: "${message.replace(/\s+/g, ' ').slice(0, 160)}"` }
            : { rule: 'Documented gap is explained to the applicant', pass: false, severity: 'fail', detail: `applicant is stopped at ${persona.blockedAt} (${url}) with no visible explanation — a silent dead end after a 12-question health screen` },
          {
            rule: `Known gap — ${persona.id}`,
            pass: true,
            severity: 'info',
            detail: persona.blockedReason ?? 'documented gap',
          },
        ]);
      }

      // Nothing may have reached a host this run did not stub.
      const unstubbed = log.urls.filter((u) => u.startsWith('UNSTUBBED '));
      record(persona, 'network', [
        unstubbed.length === 0
          ? { rule: 'No unstubbed network calls', pass: true, severity: 'fail', detail: 'every request was served by the mock' }
          : {
              rule: 'No unstubbed network calls',
              pass: false,
              severity: 'warn',
              detail: `${unstubbed.length} request(s) to a host this harness does not stub: ${unstubbed.slice(0, 5).join(', ')}`,
              data: unstubbed,
            },
      ]);

      // The analytics beacon must never carry an identifier.
      const beaconText = JSON.stringify(log.analyticsBodies);
      const beaconPhi =
        /\b[0-9][A-Z][A-Z0-9]{2}-[A-Z0-9]{3}-[A-Z0-9]{4}\b/.test(beaconText) ||
        /\b\d{3}-\d{2}-\d{4}\b/.test(beaconText) ||
        /"(dob|firstName|lastName|email|phone|mbi)"/i.test(beaconText);
      record(persona, 'network', [
        beaconPhi
          ? { rule: 'Analytics beacon carries no PHI', pass: false, severity: 'fail', detail: 'the funnel beacon posted an identifier', data: log.analyticsBodies }
          : { rule: 'Analytics beacon carries no PHI', pass: true, severity: 'fail', detail: `${log.analyticsBodies.length} beacon event(s), none carrying an identifier` },
      ]);

      await flush(persona.id);

      const mine = findings.filter((f) => f.persona === persona.id);
      const s = summarize(mine);
      const hard = mine.filter((f) => !f.pass && f.severity === 'fail');
      expect(
        hard.length,
        `${persona.id}: ${s.failed} failing check(s)\n` +
          hard.map((f) => `  [${f.screen}] ${f.rule} — ${f.detail}`).join('\n'),
      ).toBe(0);
    });
  }

  // ─── /apply ──────────────────────────────────────────────────────────────
  //
  // Walked once, with the persona that reaches results on the underwritten
  // path. /apply is stage-based behind a single route and does not branch on
  // persona, so walking it four times would cost four minutes to assert the
  // same DOM. What it does carry is the MBI, the carrier authorizations, the
  // FCC one-to-one TCPA consent and the e-signature — the highest-risk screen
  // in the product, and the one the sweep used to stop short of.
  test('apply — TCPA consent, MBI handling and submission payload', async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    const persona = PERSONAS.find((p) => p.id === 'underwritten-nc')!;
    const log: RequestLog = await installApiMocks(page, persona);

    try {
      await driveToResults(page, persona, baseURL!, async () => {});
      await enterApply(page);

      record(persona, 'apply:review', await runGlobalRules(page, '/apply'));
      await continueFromReview(page);

      await fillApplyDetails(page, persona);
      record(persona, 'apply:details', await runGlobalRules(page, '/apply'));
      await continueFromDetails(page);

      record(persona, 'apply:sign', await runGlobalRules(page, '/apply'));

      const signText = await pageText(page);
      const submitBtn = page.locator('button.btn', { hasText: /Submit application/i }).first();

      // Tick ONLY the carrier authorizations first. If a consent timestamp
      // appears now, accepting the authorizations is being treated as TCPA
      // consent — the exact bundling the one-to-one rule prohibits.
      await tickCarrierAuths(page);
      const timestampAfterCarrierAuthsOnly = /Consent recorded/i.test(await pageText(page));
      const submitEnabledBeforeConsent = await submitBtn.isEnabled();

      await tickTcpa(page);
      const timestampAfterTcpa = /Consent recorded/i.test(await pageText(page));

      record(persona, 'apply:sign', checkTcpaSeparation({
        carrierAuthCount: await carrierAuthRows(page).count(),
        tcpaRowCount: await tcpaRow(page).count(),
        tcpaHeadingPresent: /TCPA Communication Consent/i.test(signText),
        notAConditionPresent: /not a\s+condition of purchase/i.test(signText),
        optOutPresent: /Reply STOP/i.test(signText) && /data rates may apply/i.test(signText),
        timestampAfterTcpa,
        timestampAfterCarrierAuthsOnly,
        submitEnabledBeforeConsent,
      }));

      await sign(page);
      await submitApplication(page);

      record(persona, 'apply:submit', checkSubmissionPayload(log.enrollBodies, log.analyticsBodies, page.url()));
    } catch (err) {
      record(persona, 'apply', [{
        rule: 'Application flow completes',
        pass: false,
        severity: 'fail',
        detail: `/apply could not be walked to submission: ${(err as Error).message.split('\n')[0]}`,
      }]);
    }

    await flush('apply');

    const mine = findings.filter((f) => f.screen.startsWith('apply'));
    const hard = mine.filter((f) => !f.pass && f.severity === 'fail');
    expect(
      hard.length,
      `apply: ${hard.length} failing check(s)\n` +
        hard.map((f) => `  [${f.screen}] ${f.rule} — ${f.detail}`).join('\n'),
    ).toBe(0);
  });

});
