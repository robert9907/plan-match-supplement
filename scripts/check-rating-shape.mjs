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
// Community is checked from the data alone: one premium, every age. Issue age
// is NOT checked that way, and that has not changed - issue age depends on the
// age at purchase, which the stored cell does not record, so a flat-vs-rising
// test on it would be a guess. Guessing is what produced the two false policy
// form declarations this table already carried.
//
// What is new (2026-09-21) is a second rule that needs no such guess.
// labelContradictions() compares the same carrier and tier filed in two
// states. It never asks what an issue-age curve ought to look like. It asks
// only whether two curves CMS has labelled differently are the same curve, and
// a normalised curve is a fact in the data.
//
// In the 2026-09-21 Plan G scrape of NC, TX and GA, twelve carrier/gender
// pairs across three filings come back identical to within 0.41%: Bankers
// Life and its Substandard tier, and Lumos, each carrying ISSUE_AGE in GA and
// ATTAINED_AGE in NC and TX. Bankers Life GA against TX differs by 0.01% -
// the same curve, scaled, under two different labels. Every other
// differently-labelled pair in that scrape differs by at least 5.65%, so the
// 2% threshold below sits in a thirteenfold gap rather than on a judgement
// call.
//
// This does not say which label is wrong. It says both cannot be right, and
// rating_type drives the consumer disclosure that explains whether a premium
// climbs with age - so a contradiction has to stop a load, not decorate it.
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

// ─── The second rule: one curve cannot carry two labels ───────────
//
// Pure, same as violations(). `rows` is flat: one row per cell, carrying the
// state, carrier, plan, gender, age, premium and the rating type CMS gave it.

const SHAPE_TOLERANCE = 0.02; // 2% - see the header note on the 13x gap

export function labelContradictions(rows) {
  const curves = new Map();
  for (const r of rows) {
    const key = `${r.carrier_name}\u0000${r.plan_letter}\u0000${r.gender}\u0000${r.state}`;
    if (!curves.has(key)) {
      curves.set(key, { ...r, cells: new Map() });
    }
    curves.get(key).cells.set(Number(r.age), Number(r.monthly_premium));
  }

  // A shape is only comparable when both curves cover the same ages, so the
  // comparison is made on the intersection and skipped below three points.
  const byCarrier = new Map();
  for (const c of curves.values()) {
    const k = `${c.carrier_name}\u0000${c.plan_letter}\u0000${c.gender}`;
    if (!byCarrier.has(k)) byCarrier.set(k, []);
    byCarrier.get(k).push(c);
  }

  const out = [];
  for (const [k, variants] of byCarrier) {
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const a = variants[i], b = variants[j];
        if (a.state === b.state) continue;
        const ta = String(a.rating_type ?? '').toLowerCase();
        const tb = String(b.rating_type ?? '').toLowerCase();
        if (!ta || !tb || ta === tb) continue; // same label, nothing to contradict

        const ages = [...a.cells.keys()]
          .filter((age) => b.cells.has(age))
          .sort((x, y) => x - y);
        if (ages.length < 3) continue;
        const baseA = a.cells.get(ages[0]), baseB = b.cells.get(ages[0]);
        if (!(baseA > 0) || !(baseB > 0)) continue;

        let worst = 0;
        for (const age of ages) {
          const na = a.cells.get(age) / baseA;
          const nb = b.cells.get(age) / baseB;
          worst = Math.max(worst, Math.abs(na - nb) / nb);
        }
        if (worst > SHAPE_TOLERANCE) continue;

        const [carrier, plan, gender] = k.split('\u0000');
        out.push({
          carrier, plan, gender, ages,
          a: { state: a.state, ratingType: ta },
          b: { state: b.state, ratingType: tb },
          worstPct: worst * 100,
        });
      }
    }
  }
  return out.sort((x, y) => x.worstPct - y.worstPct);
}

function reportContradictions(found) {
  if (found.length === 0) {
    console.log('PASS: no carrier carries two different rating types on one curve shape.');
    return 0;
  }
  console.log(
    `FAIL: ${found.length} curve(s) are labelled with two different rating types.\n` +
    `Each pair below is the same normalised curve filed in two states under two\n` +
    `labels. Both cannot be right, and rating_type is what the rate disclosure\n` +
    `uses to tell a consumer whether the premium climbs with age.\n`,
  );
  for (const v of found) {
    console.log(`  ${v.carrier}  plan ${v.plan}  ${v.gender}`);
    console.log(
      `      ${v.a.state}: ${v.a.ratingType}   vs   ${v.b.state}: ${v.b.ratingType}` +
      `   curves agree to ${v.worstPct.toFixed(2)}% across ages ${v.ages[0]}-${v.ages[v.ages.length - 1]}`,
    );
  }
  console.log(
    '\nDo not resolve this by picking the label that suits the chart. Confirm the\n' +
    "rating type against the carrier's filed rate manual, or leave the state out.",
  );
  return 1;
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

  // ── labelContradictions ──
  const row = (state, carrier, age, premium, ratingType, gender = 'M') => ({
    state, carrier_name: carrier, plan_letter: 'G', gender, age,
    monthly_premium: premium, rating_type: ratingType,
  });
  // One curve, scaled by 1.5 between states: identical shape, different money.
  const shapeA = [181.49, 234.68, 300.75, 376.45, 458.89, 559.39, 618.23];
  const AGES7 = [65, 70, 75, 80, 85, 90, 95];
  const curve = (state, carrier, type, scale = 1) =>
    AGES7.map((age, i) => row(state, carrier, age, +(shapeA[i] * scale).toFixed(2), type));

  console.log('\n7. The same shape under two labels is a contradiction');
  let c = labelContradictions([
    ...curve('NC', 'Twin', 'attained_age'),
    ...curve('GA', 'Twin', 'issue_age', 1.5),
  ]);
  check('reported once', c.length === 1);
  check('names both labels', c.length === 1 && c[0].a.ratingType !== c[0].b.ratingType);

  console.log('\n8. The same shape under the SAME label is not a contradiction');
  c = labelContradictions([
    ...curve('NC', 'Same', 'attained_age'),
    ...curve('TX', 'Same', 'attained_age', 1.2),
  ]);
  check('same label is silent', c.length === 0);

  console.log('\n9. Different shapes under different labels are left alone');
  c = labelContradictions([
    ...curve('NC', 'Diff', 'attained_age'),
    ...AGES7.map((age, i) => row('GA', 'Diff', age, 200 + i * 5, 'issue_age')),
  ]);
  check('a genuinely different curve is not flagged', c.length === 0);

  console.log('\n10. One state cannot contradict itself');
  c = labelContradictions([
    ...curve('NC', 'Solo', 'attained_age'),
    ...curve('NC', 'Solo', 'issue_age'),
  ]);
  check('same-state pairs are skipped', c.length === 0);

  console.log('\n11. Genders are judged separately');
  c = labelContradictions([
    ...curve('NC', 'Gendered', 'attained_age'),
    ...curve('GA', 'Gendered', 'issue_age', 1.1),
    ...AGES7.map((age, i) => row('NC', 'Gendered', age, shapeA[i], 'attained_age', 'F')),
  ]);
  check('only the complete male pair is reported', c.length === 1 && c[0].gender === 'M');

  console.log('\n12. Two points are not a shape');
  c = labelContradictions([
    row('NC', 'Short', 65, 100, 'attained_age'), row('NC', 'Short', 70, 110, 'attained_age'),
    row('GA', 'Short', 65, 200, 'issue_age'), row('GA', 'Short', 70, 220, 'issue_age'),
  ]);
  check('under three shared ages is skipped', c.length === 0);

  console.log('\n13. Regression: the real Bankers Life NC/GA curves');
  // From the 2026-09-21 CMS Plan G scrape. CMS calls NC attained-age and GA
  // issue-age; the normalised curves agree to well under a percent.
  const bankersNC = [181.49, 234.68, 300.75, 376.45, 458.89, 559.39, 618.23];
  const bankersGA = [194.41, 251.36, 322.13, 403.20, 491.53, 599.10, 659.79];
  c = labelContradictions([
    ...AGES7.map((age, i) => row('NC', 'Bankers Life', age, bankersNC[i], 'attained_age')),
    ...AGES7.map((age, i) => row('GA', 'Bankers Life', age, bankersGA[i], 'issue_age')),
  ]);
  check('the live contradiction is caught', c.length === 1);
  check('and reported under 1%', c.length === 1 && c[0].worstPct < 1);

  console.log(
    failures === 0
      ? '\nPASS: the rating-shape rules hold community flat, catch one curve under two labels, and leave the rest alone'
      : `\nFAIL: ${failures} assertion(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

// ─── Live run ─────────────────────────────────────────────────────
//
// Guarded so the rules above can be imported. seed-medsup-projection.mjs
// reuses labelContradictions() to refuse a load, and an unguarded live run
// here would make that import hit the network and demand credentials.

const invokedDirectly = (process.argv[1] ?? '').endsWith('check-rating-shape.mjs');
if (!invokedDirectly) {
  // imported as a library - export the rules and do nothing else
} else {

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

const byId = new Map(carriers.map((c) => [c.id, c]));
const flat = rates.flatMap((r) => {
  const c = byId.get(r.carrier_id);
  return c ? [{ ...r, state: c.state, carrier_name: c.carrier_name, rating_type: c.rating_type }] : [];
});

const a = report(violations(carriers, rates));
console.log('');
const b = reportContradictions(labelContradictions(flat));
process.exit(a || b);

}
