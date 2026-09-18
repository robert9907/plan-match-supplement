// ---------------------------------------------------------------------------
// report.ts — findings shape and the merge that produces the punch list.
//
// The merge reads per-persona fragments off disk rather than a shared array in
// memory. Playwright restarts its worker after a test fails, which resets
// module state; an in-memory accumulator therefore reports whatever the LAST
// worker happened to hold, which during development here meant a summary that
// said "0 checks, 0 failing" while three of four personas were red.
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CheckResult } from './compliance-checks.js';

export const REPORT_DIR = 'reports';
export const FRAGMENT_DIR = path.join(REPORT_DIR, 'personas');
export const JSON_REPORT = path.join(REPORT_DIR, 'medigap-compliance.json');
export const MD_REPORT = path.join(REPORT_DIR, 'medigap-compliance.md');

export interface Finding extends CheckResult {
  persona: string;
  screen: string;
}

export async function readFragments(): Promise<Finding[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(FRAGMENT_DIR);
  } catch {
    return [];
  }
  const out: Finding[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
    try {
      const raw = await fs.readFile(path.join(FRAGMENT_DIR, name), 'utf8');
      const parsed = JSON.parse(raw) as Finding[];
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      /* a fragment a crashed worker never finished writing */
    }
  }
  return out;
}

export async function writeReports(findings: Finding[]): Promise<{ failed: number; warned: number; total: number }> {
  const failed = findings.filter((f) => !f.pass && f.severity === 'fail');
  const warned = findings.filter((f) => !f.pass && f.severity === 'warn');
  const infos = findings.filter((f) => f.severity === 'info');

  const byPersona: Record<string, { total: number; failed: number; warned: number }> = {};
  for (const f of findings) {
    byPersona[f.persona] ??= { total: 0, failed: 0, warned: 0 };
    byPersona[f.persona].total += 1;
    if (!f.pass && f.severity === 'fail') byPersona[f.persona].failed += 1;
    if (!f.pass && f.severity === 'warn') byPersona[f.persona].warned += 1;
  }

  const summary = {
    generated: new Date().toISOString(),
    total: findings.length,
    failed: failed.length,
    warned: warned.length,
    info: infos.length,
    byPersona,
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(JSON_REPORT, JSON.stringify({ summary, findings }, null, 2));

  const md: string[] = [
    '# Plan Match Supplement — Medigap compliance sweep',
    '',
    `- Generated: ${summary.generated}`,
    `- Personas walked: ${Object.keys(byPersona).length}`,
    `- Checks run: ${summary.total}`,
    `- **Failing: ${summary.failed}**`,
    `- Warnings: ${summary.warned}`,
    '',
    '## By persona',
    '',
    ...Object.entries(byPersona).map(
      ([p, v]) => `- **${p}** — ${v.failed} failing, ${v.warned} warning, ${v.total} checks`,
    ),
    '',
    '## Failing — these block the push',
    '',
    failed.length
      ? failed.map((f) => `- **${f.persona}** @ \`${f.screen}\` — *${f.rule}* — ${f.detail}`).join('\n')
      : '_Nothing failing._',
    '',
    '## Warnings — reported, do not block',
    '',
    warned.length
      ? warned.map((f) => `- **${f.persona}** @ \`${f.screen}\` — *${f.rule}* — ${f.detail}`).join('\n')
      : '_No warnings._',
    '',
    '## Recorded for review',
    '',
    infos.length
      ? [...new Map(infos.map((f) => [`${f.rule}::${f.detail}`, f])).values()]
          .map((f) => `- *${f.rule}* — ${f.detail}`)
          .join('\n')
      : '_Nothing recorded._',
    '',
  ];

  await fs.writeFile(MD_REPORT, md.join('\n'));
  return { failed: failed.length, warned: warned.length, total: summary.total };
}
