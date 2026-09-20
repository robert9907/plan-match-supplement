#!/usr/bin/env npx tsx
// ---------------------------------------------------------------------------
// discover-medigap-api.ts — SUPERSEDED 2026-09-20. It did its job: the
// contract is recorded in docs/medigap-scraper-spec.md. Kept as the record
// of how it was found, not as something to run again.
//
//   npx tsx scripts/discover-medigap-api.ts            # headful, you drive
//   MG_ZIP=75201 npx tsx scripts/discover-medigap-api.ts
//
// This is NOT the scraper. It is the one step that has to happen before the
// scraper can be written: observing the API contract instead of guessing it.
//
// Why observation and not guesswork
// ---------------------------------
// The MA/MAPD scraper in ~/Code/plan-match targets
// /api/v1/data/plan-compare/... The Medigap tool is a different product and
// its endpoint is unknown. Three paths were probed on 2026-09-20 and all
// returned 404. qa/helpers/cms-plan-finder.ts in that repo records what the
// guessing approach cost the last time:
//
//   "the SPA lays out the plan list across a multi-step wizard that's hard
//    to drive programmatically (see git history — 4 rounds of blind
//    iteration didn't clear the wizard past the drug entry step)"
//
// So this script does not try to drive the wizard. It opens a real browser,
// gets out of the way, and records what the page does while a human clicks
// through once. Thirty seconds of human attention beats four rounds of blind
// iteration.
//
// Bootstrap (all load-bearing, carried from scrape-medicare-gov.ts)
// -----------------------------------------------------------------
//   channel:'chrome'  bundled Chromium's TLS handshake is Akamai-flagged and
//                     its requests die with ERR_HTTP2_PROTOCOL_ERROR
//   real Chrome UA    same reason
//   12s warm-up       lets Akamai's sensor JS set the _abck cookie before
//                     anything interesting happens
//
// Output: data/medigap-api-capture.json — method, path, query KEYS, and the
// SHAPE of request and response bodies. Values are redacted: this file gets
// committed, and it is a recording of a government site's internals, not a
// place for anyone's data. A ZIP code is the only input and it is yours.
// ---------------------------------------------------------------------------

import { chromium, type Request, type Response } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'data/medigap-api-capture.json';
const ZIP = process.env.MG_ZIP ?? '27713';
const START = 'https://www.medicare.gov/medigap-supplemental-insurance-plans/';
const SPA_WARMUP_MS = 12_000;
/** Hard cap on the whole session. */
const CAPTURE_WINDOW_MS = Number(process.env.MG_WINDOW_MS ?? 5 * 60_000);
/** Finish once something is captured and the page goes quiet this long. */
const QUIET_MS = Number(process.env.MG_QUIET_MS ?? 10_000);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Describe a value's shape without keeping the value. */
function shape(v: unknown, depth = 0): unknown {
  if (v === null) return 'null';
  if (Array.isArray(v)) return depth > 3 ? `array[${v.length}]` : [v.length ? shape(v[0], depth + 1) : 'empty'];
  if (typeof v === 'object') {
    if (depth > 3) return 'object';
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v;
}

function parse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function main(): Promise<void> {
  const captured: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let lastSeen = Date.now();

  const browser = await chromium.launch({
    headless: process.env.MG_HEADFUL === '0',
    channel: 'chrome',
  });
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  page.on('response', async (resp: Response) => {
    const req: Request = resp.request();
    const url = new URL(resp.url());
    if (!/medicare\.gov$/.test(url.hostname)) return;
    if (!/json/i.test(resp.headers()['content-type'] ?? '')) return;

    const key = `${req.method()} ${url.pathname}`;
    if (seen.has(key)) return;           // one example per endpoint
    seen.add(key);

    let body: unknown = null;
    try { body = parse((await resp.text()).slice(0, 400_000)); } catch { /* streamed away */ }

    captured.push({
      method: req.method(),
      path: url.pathname,
      queryKeys: [...url.searchParams.keys()],
      status: resp.status(),
      requestBodyShape: shape(parse(req.postData() ?? '')),
      responseShape: shape(body),
    });
    lastSeen = Date.now();
    console.log(`  captured  ${key}`);
  });

  console.log(`\nOpening the Medigap tool. Warm-up ${SPA_WARMUP_MS / 1000}s (Akamai).`);
  await page.goto(START, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SPA_WARMUP_MS);
  lastSeen = Date.now();

  console.log(`
────────────────────────────────────────────────────────────────────────
  Drive the wizard yourself in the window that just opened.

    ZIP ${ZIP}, then step through to the plan list. If it asks for a date
    of birth or an age, USE ONE — that is the whole point: we need to see
    whether age is a request parameter, and what it is called.

    Then change the age and step through again, so the capture contains
    two ages and the parameter is unambiguous.

  Nothing to press. This finishes on its own ${QUIET_MS / 1000}s after the
  last call it sees, or at ${CAPTURE_WINDOW_MS / 60_000} minutes, whichever
  comes first.
────────────────────────────────────────────────────────────────────────
`);

  // No stdin wait. An earlier version of this script blocked on a keypress,
  // which meant no non-interactive shell could run it — it could only ever
  // hang to its timeout. Finish on quiet instead: once something has been
  // captured and the page has been silent for QUIET_MS, we have what we
  // came for.
  const deadline = Date.now() + CAPTURE_WINDOW_MS;
  let announced = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);
    if (captured.length > announced) {
      announced = captured.length;
      continue;
    }
    if (captured.length > 0 && Date.now() - lastSeen > QUIET_MS) {
      console.log(`\n  Quiet for ${QUIET_MS / 1000}s — wrapping up.`);
      break;
    }
    if (page.isClosed()) break;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    captured_at: new Date().toISOString(),
    zip_used: ZIP,
    note: 'Shapes only — no values. Paste the contract into docs/medigap-scraper-spec.md.',
    endpoints: captured,
  }, null, 2) + '\n');

  console.log(`\nWrote ${OUT} — ${captured.length} distinct endpoint(s).`);
  for (const e of captured) console.log(`  ${e.method} ${e.path}  ?${(e.queryKeys as string[]).join('&')}`);
  if (!captured.length) {
    console.log('\nNothing captured. Either the wizard was not completed, or the');
    console.log('plan list is server-rendered rather than fetched — which is itself');
    console.log('the finding, and means the scraper needs a different approach.');
  }
  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
