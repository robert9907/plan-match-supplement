#!/usr/bin/env node
// Does each carrier's projected curve match the rating type it is sold under?
//
// A Medigap policy is filed as one of three rating types, and the type is a
// statement about what the premium does as the insured ages:
//
//   attained_age    rises with the insured's current age
//   issue_age       set by age at purchase, then does not rise with age
//   community       the same premium at every age
//
// The projection chart draws a premium for ages 65..95 and the stat cards
// total them. Those totals are rate representations under NAIC Medigap Model
// Act 13. If a community-rated carrier is drawn rising, the chart shows a
// consumer an increase the policy cannot charge them for, and the 20-year
// total overstates that carrier against every competitor on the same screen.
//
// NC looked like the case for this check and then complicated it. CMS files
// AARP/UnitedHealthcare in NC as COMMUNITY_RATED at one statewide premium,
// 165.44 for a woman, identical across all twelve sampled ZIPs, and the
// projection draws her rising to 274.50 by 95.
//
// But a live HealthSherpa quote on 2026-09-20 returned the same carrier,
// labelled "Community Rated" on its own screen, at 188.79 for a 65-year-old
// man and 207.36 for a 70-year-old - a 9.8% climb, quoted by the source
// itself. All three AARP entities behave that way, and the stored curve
// reproduces the quotes to the cent at both ages.
//
// So a failure here does NOT mean the stored data is wrong. It means the
// label and the curve disagree, and which one to believe is a question for
// the carrier's rate manual. UnitedHealthcare's AARP plans are widely
// described as applying an enrollment discount that declines with age, which
// would let a flat community rate produce rising quotes - but that is a
// hypothesis, not a sourced fact, and inventing mechanisms is what put two
// fictitious policy forms in carrier-aliases.json.
//
// Treat this as a reporting check, not a correctness check, until that is
// settled. It is deliberately not in gate.config.json.
//
// Community is checked here and issue-age is not, deliberately. Community is
// decidable from the data alone: one premium, every age. Issue age depends on
// the age at purchase, which the stored cell does not record, so a flat-vs-
// rising test on it would be a guess. Guessing is what produced the two false
// policy-form declarations this table already carried.
//
// Run:  node scripts/check-rating-shape.mjs
//       node scripts/check-rating-shape.mjs --self-test
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or .env.local in cwd).

import { readFileSync, existsSync } from 'node:fs';

const TOLERANCE = 0.01; // one cent

// ─── The rule ─────────────────────────────────────────────────────
//
// Pure, so the self-test drives the same code the live run does.

export function violations(carriers, rates) {
  const byId = new Map(carriers.map((c) => [c.id, c]));
  const groups = new Map();

  for (const r of rates) {
    const c = byId.get(r.carrier_id);
    if (!c || String(c.rating_type ?? '').toLowerCase() !== 'community') continue;
    const key = `${c.state}\u0000${c.carrier_name}\u0000${r.plan_letter}\u0000${r.gender}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ age: Number(r.age), premium: Number(r.monthly_premium) });
  }

  const out = [];
  for (const [key, cells] of groups) {
    if (cells.length < 2) continue;
    const priced = cells.filter((c) => Number.isFinite(c.premium));
    if (priced.length < 2) continue;
    const lo = priced.reduce((a, b) => (b.premium < a.premium ? b : a));
    const hi = priced.reduce((a, b) => (b.premium > a.premium ? b : a));
    if (hi.premium - lo.premium <= TOLERANCE) continue;
    const [state, carrier, plan, gender] = key.split('\u0000');
    out.push({
      state, carrier, plan, gender,
      lo, hi,
      spreadPct: ((hi.premium - lo.premium) / lo.premium) * 100,
      cells: priced.sort((a, b) => a.age - b.age),
    });
  }
  return out.sort((a, b) => b.spreadPct - a.spreadPct);
}

function report(found) {
  if (found.length === 0) {
    console.log('PASS: every community-rated carrier is drawn flat across ages 65-95.');
    return 0;
  }
  console.log(
    `FAIL: ${found.length} community-rated curve(s) vary with age. A community-rated\n` +
    `premium is the same at every age, so each of these shows a consumer an increase\n` +
    `the policy cannot charge, and inflates that carrier's projected total.\n`,
  );
  for (const v of found) {
    const money = (n) => `$${n.toFixed(2)}`;
    console.log(`  ${v.state}  ${v.carrier}  plan ${v.plan}  ${v.gender}`);
    console.log(
      `      ${money(v.lo.premium)} at ${v.lo.age}  ->  ${money(v.hi.premium)} at ${v.hi.age}` +
      `   (+${v.spreadPct.toFixed(1)}%)`,
    );
    console.log(`      cells: ${v.cells.map((c) => `${c.age}:${money(c.premium)}`).join('  ')}\n`);
  }
  console.log(
    'Do not "fix" either side from this output alone. The label and the curve\n' +
    'disagree; the quoting source may itself quote a community-rated policy\n' +
    "rising with age. Confirm against the carrier's filed rate manual before\n" +
    'changing the curve, the rating_type, or this check.',
  );
  return 1;
}

// ─── Self-test ────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  let failures = 0;
  const check = (name, cond) => {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!cond) failures++;
  };

  const carriers = [
    { id: 1, state: 'NC', carrier_name: 'Community Flat', rating_type: 'community' },
    { id: 2, state: 'NC', carrier_name: 'Community Rising', rating_type: 'community' },
    { id: 3, state: 'NC', carrier_name: 'Attained Rising', rating_type: 'attained_age' },
    { id: 4, state: 'NC', carrier_name: 'Issue Rising', rating_type: 'issue_age' },
    { id: 5, state: 'NC', carrier_name: 'Community Cent', rating_type: 'community' },
  ];
  const cell = (carrier_id, age, monthly_premium, gender = 'F') =>
    ({ carrier_id, age, monthly_premium, gender, plan_letter: 'G' });

  console.log('\n1. A community-rated carrier drawn flat passes');
  let found = violations(carriers, [cell(1, 65, 165.44), cell(1, 95, 165.44)]);
  check('no violation', found.length === 0);

  console.log('\n2. A community-rated carrier drawn rising fails');
  found = violations(carriers, [cell(2, 65, 167.44), cell(2, 95, 274.5)]);
  check('one violation', found.length === 1);
  check('names the carrier', found[0]?.carrier === 'Community Rising');
  check('reports the real spread', Math.abs(found[0].spreadPct - 63.94) < 0.1);
  check('carries the endpoints', found[0].lo.premium === 167.44 && found[0].hi.premium === 274.5);

  console.log('\n3. Other rating types are not touched');
  found = violations(carriers, [
    cell(3, 65, 100), cell(3, 95, 400),
    cell(4, 65, 100), cell(4, 95, 400),
  ]);
  check('attained_age rising is fine', found.length === 0);

  console.log('\n4. The tolerance is a cent, not a licence');
  found = violations(carriers, [cell(5, 65, 200.0), cell(5, 95, 200.01)]);
  check('a one-cent spread passes', found.length === 0);
  found = violations(carriers, [cell(5, 65, 200.0), cell(5, 95, 200.25)]);
  check('a quarter does not', found.length === 1);

  console.log('\n5. Genders and plans are judged separately');
  found = violations(carriers, [
    cell(2, 65, 100, 'F'), cell(2, 95, 100, 'F'),
    cell(2, 65, 100, 'M'), cell(2, 95, 180, 'M'),
  ]);
  check('only the male curve is reported', found.length === 1 && found[0].gender === 'M');

  console.log('\n6. A single cell cannot be a violation');
  found = violations(carriers, [cell(2, 65, 167.44)]);
  check('one cell is not a shape', found.length === 0);

  console.log(
    failures === 0
      ? '\nPASS: the rating-shape rule holds community flat and leaves the others alone'
      : `\nFAIL: ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ─── Live run ─────────────────────────────────────────────────────

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=("?)([^"\n]*)\2$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
  }
}
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const base = SUPABASE_URL.replace(/\/$/, '');
async function rest(path) {
  const resp = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) {
    console.error(`Query failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    process.exit(1);
  }
  return resp.json();
}

const carriers = await rest('pm_medsup_carrier?select=id,state,carrier_name,rating_type&active=eq.true');
const rates = await rest('pm_medsup_rate?select=carrier_id,plan_letter,age,gender,monthly_premium&tobacco=eq.false');
process.exit(report(violations(carriers, rates)));
