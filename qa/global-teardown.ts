// Merges the per-persona fragments into one punch list after every run,
// whether or not individual tests failed.
import { readFragments, writeReports, MD_REPORT } from './helpers/report.js';

export default async function globalTeardown(): Promise<void> {
  const findings = await readFragments();
  const { failed, warned, total } = await writeReports(findings);

  // Zero checks means no persona got far enough to run one — a crashed browser
  // launch, a dead server, a broken config. Playwright's exit code catches it,
  // but "0 failed, 0 checks" on its own reads like a clean run, and this
  // harness exists precisely so a failure is never mistaken for a pass.
  if (total === 0) {
    console.log(
      '\nMedigap compliance: NO CHECKS RAN. Nothing was verified — this is not a pass. ' +
        'Look at the Playwright output above for why the personas could not start.',
    );
    return;
  }
  // Printed in this shape so the ship gate's summaryLine() picks up real
  // numbers to echo, instead of reporting a failing run as "passed".
  console.log(`\nMedigap compliance: ${failed} failed, ${warned} warned, ${total} checks — ${MD_REPORT}`);
}
