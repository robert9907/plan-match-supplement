// ---------------------------------------------------------------------------
// playwright.config.ts — Supplement compliance harness.
//
// The point of this config is the webServer block. The MA consumer harness
// defaults BASE_URL to production and has no webServer, which is exactly why
// its fullAudit gate could never be enabled: it cannot test the commit you are
// about to push. This one builds HEAD and serves it, so the run describes the
// code in the push and nothing else.
//
// Set QA_BASE_URL to point at a deployed environment instead (a pre-AEP
// check against production, say). The webServer is skipped when it is set.
// ---------------------------------------------------------------------------

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// package.json sets "type": "module", so Playwright loads this config as ESM,
// where __dirname and require do not exist. Using either throws
// "ReferenceError: __dirname is not defined in ES module scope" while the
// config is still loading, which takes out the entire suite before a single
// test runs — it did exactly that between 2026-09-17 and 2026-09-18. Derive
// the directory from import.meta.url, and give globalSetup/globalTeardown
// plain relative paths, which Playwright resolves against this file.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const externalBase = process.env.QA_BASE_URL;
const PORT = Number(process.env.QA_PORT ?? 4174);
const baseURL = externalBase ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  // One worker: the punch list is aggregated across personas. Not serial —
  // see the note in specs/medigap-compliance.spec.ts.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'reports/playwright.json' }]],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    // The widget ships inside a 420-ish px iframe on WordPress; test at the
    // width most consumers actually see, since font-size findings depend on
    // it. Must come AFTER the ...devices spread, which also sets viewport.
    viewport: { width: 420, height: 1400 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 420, height: 1400 } },
    },
  ],

  webServer: externalBase
    ? undefined
    : {
        // Build then serve HEAD. `--strictPort` makes a port clash a loud
        // failure instead of a run that silently tests a stale server.
        command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
        url: baseURL,
        cwd: repoRoot,
        reuseExistingServer: false,
        timeout: 180_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
