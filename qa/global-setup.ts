// Clears last run's fragments so a persona that is skipped this time cannot
// contribute stale findings to this run's punch list.
import fs from 'node:fs/promises';
import { FRAGMENT_DIR } from './helpers/report.js';

export default async function globalSetup(): Promise<void> {
  await fs.rm(FRAGMENT_DIR, { recursive: true, force: true });
  await fs.mkdir(FRAGMENT_DIR, { recursive: true });
}
