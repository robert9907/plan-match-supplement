// Merges the per-persona fragments into one punch list after every run,
// whether or not individual tests failed.
import { readFragments, writeReports, MD_REPORT } from './helpers/report.js';

export default async function globalTeardown(): Promise<void> {
  const findings = await readFragments();
  const { failed, warned, total } = await writeReports(findings);
  // Printed in this shape so the ship gate's summaryLine() picks up real
  // numbers to echo, instead of reporting a failing run as "passed".
  console.log(`\nMedigap compliance: ${failed} failed, ${warned} warned, ${total} checks — ${MD_REPORT}`);
}
