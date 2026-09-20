#!/usr/bin/env node
// ---------------------------------------------------------------------------
// _smoke-provenance-forms.mjs — exercise every outcome of
// audit-medsup-provenance.mjs without a database.
//
//   node scripts/_smoke-provenance-forms.mjs
//
// The audit decides whether a premium on a consumer screen belongs to the
// carrier it is shown under. The `declared` outcome added on 2026-09-19 is an
// escape hatch, and an escape hatch nobody tests is a hole. So each case below
// is one way the check can be wrong:
//
//   ok            a filed figure under its own name           — must be silent
//   declared      a real policy form, within its allowance     — must be LOUD
//   declared      ...that also matches another company         — must say so
//   OVER ALLOWED  a form quoted beyond what was declared       — must fail
//   BAD DECLARE   a declaration with the reasoning left out    — must fail
//   BAD DECLARE   a declaration naming a company nobody filed  — must fail
//   MISMATCH      a premium nobody filed, undeclared           — must fail
//   NEEDS A NAME  a premium another company filed              — must fail
//
// It runs the real script, in a throwaway cwd with its own aliases file, with
// fetch stubbed. Nothing here touches the shipped data or the database.
// ---------------------------------------------------------------------------

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const AUDIT = resolve('scripts/audit-medsup-provenance.mjs');
const root = mkdtempSync(join(tmpdir(), 'prov-'));
mkdirSync(join(root, 'data/medsup-projection'), { recursive: true });

// ── fixtures ────────────────────────────────────────────────────────────
const CARRIERS = [
  { id: 1, carrier_name: 'Aetna Health Insurance Company', naic_code: null },
  { id: 2, carrier_name: 'BlueCross BlueShield of Texas (Plan G)', naic_code: null },
  { id: 3, carrier_name: 'Mutual of Omaha (Mutual of Omaha Insurance Company)', naic_code: null },
  { id: 4, carrier_name: 'Overreach Mutual (Plan G)', naic_code: null },
  { id: 5, carrier_name: 'No Reason Given Life', naic_code: null },
  { id: 6, carrier_name: 'Points At Nobody Life', naic_code: null },
  { id: 7, carrier_name: 'Ghost Carrier', naic_code: null },
  { id: 8, carrier_name: 'Wrong Name Co', naic_code: null },
];
const RATES = [
  { carrier_id: 1, gender: 'M', monthly_premium: 259.98 }, // inside Aetna
  { carrier_id: 2, gender: 'M', monthly_premium: 214.57 }, // declared, +9.34%
  { carrier_id: 3, gender: 'M', monthly_premium: 247.98 }, // declared, +1.24%
  { carrier_id: 4, gender: 'M', monthly_premium: 420.00 }, // declared but way over
  { carrier_id: 5, gender: 'M', monthly_premium: 300.00 }, // declaration has no `why`
  { carrier_id: 6, gender: 'M', monthly_premium: 300.00 }, // declares a company nobody filed
  { carrier_id: 7, gender: 'M', monthly_premium: 999.99 }, // nobody filed it
  { carrier_id: 8, gender: 'M', monthly_premium: 316.71 }, // Aetna's figure, wrong name
];
// Real TX shapes. BCBSTX and Medico Standard II overlap at 214.57 on purpose:
// that is what makes case 2 print the "ALSO inside" note.
const FILINGS = [
  { company: 'Aetna Health Insurance Company', gender: 'MALE', rate_min: 236.32 },
  { company: 'Aetna Health Insurance Company', gender: 'MALE', rate_min: 316.71 },
  { company: 'BlueCross BlueShield of Texas', gender: 'MALE', rate_min: 179.03 },
  { company: 'BlueCross BlueShield of Texas', gender: 'MALE', rate_min: 196.25 },
  { company: 'Mutual of Omaha (Mutual of Omaha Insurance Company)', gender: 'MALE', rate_min: 184.21 },
  { company: 'Mutual of Omaha (Mutual of Omaha Insurance Company)', gender: 'MALE', rate_min: 244.94 },
  { company: 'Medico Life and Health Insurance Company (Standard II)', gender: 'MALE', rate_min: 197.13 },
  { company: 'Medico Life and Health Insurance Company (Standard II)', gender: 'MALE', rate_min: 251.88 },
];

const GOOD_WHY =
  'CMS carries one Plan G figure for this company and the quoting tool sells two distinct forms; this is the second.';
const GOOD_EV = 'HealthSherpa agent portal, ZIP 75201, quoted 2026-09-19.';

writeFileSync(
  join(root, 'data/medsup-projection/carrier-aliases.json'),
  JSON.stringify({
    aliases: {},
    forms: {
      TX: {
        'BlueCross BlueShield of Texas (Plan G)': {
          cms_company: 'BlueCross BlueShield of Texas',
          max_offset_pct: 12, why: GOOD_WHY, evidence: GOOD_EV, verified_on: '2026-09-19',
        },
        'Mutual of Omaha (Mutual of Omaha Insurance Company)': {
          cms_company: 'Mutual of Omaha (Mutual of Omaha Insurance Company)',
          max_offset_pct: 3, why: GOOD_WHY, evidence: GOOD_EV, verified_on: '2026-09-19',
        },
        'Overreach Mutual (Plan G)': {
          cms_company: 'BlueCross BlueShield of Texas',
          max_offset_pct: 5, why: GOOD_WHY, evidence: GOOD_EV, verified_on: '2026-09-19',
        },
        'No Reason Given Life': {
          cms_company: 'Aetna Health Insurance Company',
          max_offset_pct: 40, why: 'because', evidence: GOOD_EV, verified_on: '2026-09-19',
        },
        'Points At Nobody Life': {
          cms_company: 'A Company That Never Filed Here',
          max_offset_pct: 10, why: GOOD_WHY, evidence: GOOD_EV, verified_on: '2026-09-19',
        },
      },
    },
  }, null, 2) + '\n',
);

const stub = join(root, 'stub-fetch.mjs');
writeFileSync(stub, `
const CARRIERS = ${JSON.stringify(CARRIERS)};
const RATES = ${JSON.stringify(RATES)};
const FILINGS = ${JSON.stringify(FILINGS)};
globalThis.fetch = async (url) => {
  const u = String(url);
  const body =
    u.includes('pm_medsup_carrier') ? CARRIERS :
    u.includes('pm_medsup_rate') ? RATES :
    u.includes('pm_supp_carrier_rates') ? FILINGS : [];
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};
`);

let out = '', code = 0;
try {
  out = execFileSync(process.execPath, ['--import', stub, AUDIT, 'TX'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPABASE_URL: 'https://rpcbrkmvalvdmroqzpaq.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'stub',
    },
  });
} catch (e) {
  out = (e.stdout ?? '') + (e.stderr ?? '');
  code = e.status ?? 1;
}

console.log(out);
console.log('─'.repeat(72));

let failures = 0;
function check(label, actual, expected) {
  if (actual === expected) console.log(`  ok    ${label}`);
  else { failures++; console.error(`  FAIL  ${label}\n          expected ${expected}\n          actual   ${actual}`); }
}
const has = (t) => out.includes(t);
const count = (t) => out.split(t).length - 1;

console.log('\n1. A filed figure under its own name says nothing at all');
check('Aetna is not mentioned as a problem', /Aetna Health Insurance Company M 65 = \$259\.98/.test(out), false);

console.log('\n2. A declared form passes, and is reported rather than hidden');
check('BCBS (Plan G) is not failed', has('NEEDS A NAME  BlueCross BlueShield of Texas (Plan G)'), false);
check('it appears in the declared block', has('declared form of BlueCross BlueShield of Texas'), true);
check('the offset it consumed is stated', has('offset +9.34% of an allowance of 12%'), true);
check('Mutual of Omaha likewise', has('offset +1.24% of an allowance of 3%'), true);
check('two declarations were used', count('declared form of'), 2);

console.log('\n3. A declaration never hides a figure another company also filed');
check(
  "BCBS's declared row names the other companies whose range contains $214.57",
  /BlueCross BlueShield of Texas \(Plan G\) M 65[\s\S]{0,300}?ALSO inside the filed range of:[^\n]*Medico Life and Health Insurance Company \(Standard II\)/.test(out),
  true,
);
check('every declared row carries the note', count('ALSO inside the filed range of:'), 2);

console.log('\n4. The allowance is a limit, not a formality');
check('a form beyond its allowance fails', has('OVER ALLOWED  Overreach Mutual (Plan G)'), true);
check('and the script says by how much', /OVER ALLOWED[\s\S]{0,400}?\+114\.01%/.test(out), true);

console.log('\n5. A declaration without reasoning is not a declaration');
check('a two-word `why` is rejected', has('BAD DECLARE   No Reason Given Life'), true);
check('and says what is missing', has('why must say'), true);
check('a declaration naming nobody is rejected', has('BAD DECLARE   Points At Nobody Life'), true);

console.log('\n6. The original outcomes still work');
check('an unfiled premium is a MISMATCH', has('MISMATCH      Ghost Carrier'), true);
check("another company's figure NEEDS A NAME", has('NEEDS A NAME  Wrong Name Co'), true);

console.log('\n7. The run fails, and counts only the real failures');
check('exit code is 1', code, 1);
check('five unresolved', has('FAIL: 5 age-65 premium(s)'), true);

rmSync(root, { recursive: true, force: true });

if (failures > 0) { console.error(`\nFAILED: ${failures} assertion(s)\n`); process.exit(1); }
console.log('\nPASS: a declared form is narrow, loud, and cannot be used to wave a row through\n');
