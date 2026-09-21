#!/usr/bin/env node
// ---------------------------------------------------------------------------
// seed-medsup-projection.mjs — seed the rate-projection chart for a state.
//
// The chart on /rates reads pm_medsup_rate: an age-banded premium per
// carrier, 65→95 in steps of 5, per gender. That is a different table from
// the one /results prices from. pm_supp_carrier_rates (the CMS Plan Finder
// scrape) holds rate_min/rate_max per company — a RANGE, with no age
// dimension — so a 20-year curve cannot be derived from it. The age-banded
// numbers have to be quoted and entered by hand. This script is the safe
// path for doing that.
//
// Three modes, run in order:
//
//   node scripts/seed-medsup-projection.mjs --init-carriers TX
//       Builds data/medsup-projection/tx-carriers.json from the CMS scrape:
//       every company filed in that state, with its real rate type, phone
//       and website, minus anything on the migration-005 suppression list.
//       Every entry starts "seed": false. Set it true for the carriers you
//       are appointed with — that list is yours, not the database's.
//
//   node scripts/seed-medsup-projection.mjs --template TX
//       Emits data/medsup-projection/tx-rates.csv with one blank row per
//       (carrier, gender, age) for the carriers you marked seed:true.
//       HealthSherpa returns every carrier in a single quote, so filling it
//       is 14 runs — 7 ages x 2 genders — not one lookup per row.
//
//   node scripts/seed-medsup-projection.mjs --apply TX          (dry run)
//   node scripts/seed-medsup-projection.mjs --apply TX --write  (commits)
//       Validates the CSV, then upserts pm_medsup_carrier and
//       pm_medsup_rate. Dry run by default: it prints exactly what it would
//       write and changes nothing.
//
// The validation is the point. This is rate data going in front of a
// 68-year-old deciding what to buy, typed by hand from a quoting tool. The
// checks below are what stands between a mistyped digit and a wrong premium
// on a live screen — in particular the cross-check against the CMS range,
// which catches a transposed or dropped digit without anyone re-reading the
// spreadsheet.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or .env.local in cwd.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─── env ────────────────────────────────────────────────────────────────────
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=("?)([^"\n]*)\2$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
  }
}
const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Only the modes that actually talk to the database need credentials.
// --template and the --apply dry run read local files and print; demanding
// a service-role key for them just blocks the step that needs none.
function requireCreds() {
  if (!URL_BASE || !KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or .env.local).');
    process.exit(1);
  }
  // Guard against pointing this at the CRM by mistake — pm_* lives in
  // plan-match-prod and nowhere else.
  if (!/rpcbrkmvalvdmroqzpaq/.test(URL_BASE)) {
    console.error(`SUPABASE_URL is ${URL_BASE}`);
    console.error('pm_medsup_* lives in plan-match-prod (rpcbrkmvalvdmroqzpaq). Refusing to run.');
    process.exit(1);
  }
}

const AGES = [65, 70, 75, 80, 85, 90, 95];
const GENDERS = ['M', 'F'];
const PLAN = 'G';
const TOBACCO = false;
const SOURCE = 'healthsherpa';

// --apply-cms reads the Plan Finder scrape instead of a hand-filled sheet.
// CMS is the source of truth for filed Medigap rates; HealthSherpa is a
// quoting surface that derives some of what it shows (NC "Medico" is CMS
// Medico Preferred x 0.81634 at every band — a number no carrier filed).
// So where CMS covers a state, these rows supersede the hand-entered ones.
const SOURCE_CMS = 'cms';
const CMS_PATH = resolve('data/medsup-projection/cms-rates.csv');
const cmsUrl = (st, zip, age, gender) =>
  'https://www.medicare.gov/api/v1/data/plan-compare/medigap/policies' +
  `?medigap_plan_type=MEDIGAP_PLAN_TYPE_G&state=${st}&zipcode=${zip}` +
  `&age=${age}&gender=GENDER_${gender === 'F' ? 'FE' : ''}MALE&tobacco=false`;

// CMS spells these one way, pm_medsup_carrier.rating_type another. The NC
// rows use 'attained_age' and 'community', so match them exactly — the
// projection widget and the per-carrier label on /results both read this.
const RATING_TYPE = {
  ATTAINED_AGE: 'attained_age',
  ISSUE_AGE: 'issue_age',
  COMMUNITY_RATED: 'community',
};

// ─── args ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const mode = argv.find((a) => a.startsWith('--')) ?? '';
const state = (argv.find((a) => /^[A-Z]{2}$/.test(a)) ?? '').toUpperCase();
const WRITE = argv.includes('--write');
if (!state || !['--init-carriers', '--template', '--apply', '--apply-cms', '--supersede'].includes(mode)) {
  console.error('usage: seed-medsup-projection.mjs --init-carriers|--template|--apply|--apply-cms|--supersede <STATE> [--write]');
  process.exit(1);
}
const slug = state.toLowerCase();
const CARRIERS_PATH = resolve(`data/medsup-projection/${slug}-carriers.json`);
const RATES_PATH = resolve(`data/medsup-projection/${slug}-rates.csv`);

// ─── rest helpers ───────────────────────────────────────────────────────────
async function rest(path, init = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

const money = (n) => `$${Number(n).toFixed(2)}`;

// ─── mode: --init-carriers ──────────────────────────────────────────────────
async function initCarriers() {
  requireCreds();
  const [filed, exclusions] = await Promise.all([
    rest(`pm_supp_carrier_rates?state=eq.${state}&plan=eq.G&select=company,rate_type,phone,website,rate_min,rate_max`),
    rest('pm_medsup_carrier_exclusions?select=match_pattern,carrier_label'),
  ]);

  const byCompany = new Map();
  for (const row of filed) {
    const c = byCompany.get(row.company) ?? {
      carrier_name: row.company,
      rate_type: row.rate_type,
      phone: (row.phone ?? '').trim() || null,
      website: (row.website ?? '').trim() || null,
      cms_plan_g_low: Infinity,
      cms_plan_g_high: 0,
    };
    c.cms_plan_g_low = Math.min(c.cms_plan_g_low, Number(row.rate_min));
    c.cms_plan_g_high = Math.max(c.cms_plan_g_high, Number(row.rate_max));
    byCompany.set(row.company, c);
  }

  const suppressed = [];
  const out = [];
  for (const c of byCompany.values()) {
    const hit = exclusions.find((e) =>
      new RegExp('^' + e.match_pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(c.carrier_name),
    );
    if (hit) { suppressed.push(`${c.carrier_name} (${hit.carrier_label})`); continue; }
    out.push({
      ...c,
      cms_plan_g_low: Math.round(c.cms_plan_g_low),
      cms_plan_g_high: Math.round(c.cms_plan_g_high),
      // Yours to set. The database knows who FILED in this state; only you
      // know who you can actually write.
      seed: false,
      am_best: null,
      naic_code: null,
    });
  }
  out.sort((a, b) => a.cms_plan_g_low - b.cms_plan_g_low);

  mkdirSync(dirname(CARRIERS_PATH), { recursive: true });
  writeFileSync(CARRIERS_PATH, JSON.stringify({ state, generated: new Date().toISOString(), carriers: out }, null, 2) + '\n');

  console.log(`Wrote ${CARRIERS_PATH}`);
  console.log(`  ${out.length} carrier(s) filed in ${state}, all seed:false — set the ones you are appointed with to true.`);
  if (suppressed.length) {
    console.log(`  ${suppressed.length} excluded by the migration-005 suppression list:`);
    for (const s of suppressed) console.log(`    - ${s}`);
  }
  console.log('  cms_plan_g_low/high are the CMS filed range; --apply checks your entries against them.');
}

// ─── mode: --template ───────────────────────────────────────────────────────
function loadCarriers() {
  if (!existsSync(CARRIERS_PATH)) {
    console.error(`${CARRIERS_PATH} not found — run --init-carriers ${state} first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(CARRIERS_PATH, 'utf8'));
}

function template() {
  const { carriers } = loadCarriers();
  const picked = carriers.filter((c) => c.seed);
  if (!picked.length) {
    console.error(`No carriers marked "seed": true in ${CARRIERS_PATH}. Nothing to template.`);
    process.exit(1);
  }
  const lines = ['carrier_name,gender,age,monthly_premium'];
  for (const c of picked) {
    for (const g of GENDERS) for (const a of AGES) lines.push(`"${c.carrier_name}",${g},${a},`);
  }
  writeFileSync(RATES_PATH, lines.join('\n') + '\n');
  console.log(`Wrote ${RATES_PATH}`);
  console.log(`  ${picked.length} carrier(s) x ${GENDERS.length} gender(s) x ${AGES.length} age(s) = ${lines.length - 1} cells to fill.`);
  console.log(`  Plan ${PLAN}, non-tobacco, to match the existing NC set.`);
  console.log(`  HealthSherpa returns every carrier per quote, so that is ${GENDERS.length * AGES.length} quote runs.`);
  console.log('  Leave a cell blank if the carrier does not quote at that age — blanks are skipped, not zeroed.');
}

// ─── csv ────────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ─── mode: --apply ──────────────────────────────────────────────────────────
async function apply() {
  const { carriers } = loadCarriers();
  const picked = carriers.filter((c) => c.seed);
  if (!picked.length) { console.error('No carriers marked seed:true.'); process.exit(1); }
  if (!existsSync(RATES_PATH)) { console.error(`${RATES_PATH} not found — run --template ${state} first.`); process.exit(1); }

  const byName = new Map(picked.map((c) => [c.carrier_name, c]));
  const rows = parseCsv(readFileSync(RATES_PATH, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  const need = ['carrier_name', 'gender', 'age', 'monthly_premium'];
  if (need.some((h, i) => header[i] !== h)) {
    console.error(`CSV header must be: ${need.join(',')}`);
    process.exit(1);
  }

  const errors = [], warnings = [], cells = [];
  const seen = new Set();

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const [name, gender, ageStr, premStr] = r.map((x) => x.trim());
    if (!premStr) return; // deliberately blank — carrier does not quote here

    const c = byName.get(name);
    if (!c) { errors.push(`line ${line}: "${name}" is not a seed:true carrier in ${slug}-carriers.json`); return; }
    if (!GENDERS.includes(gender)) { errors.push(`line ${line}: gender "${gender}" must be M or F`); return; }
    const age = Number(ageStr);
    if (!AGES.includes(age)) { errors.push(`line ${line}: age ${ageStr} must be one of ${AGES.join(', ')}`); return; }
    const premium = Number(premStr.replace(/[$,]/g, ''));
    if (!Number.isFinite(premium) || premium <= 0) { errors.push(`line ${line}: premium "${premStr}" is not a positive number`); return; }

    const key = `${name}|${gender}|${age}`;
    if (seen.has(key)) { errors.push(`line ${line}: duplicate cell for ${name} ${gender} ${age}`); return; }
    seen.add(key);

    // The cross-check that earns this script its keep — but it only means
    // anything at 65. pm_supp_carrier_rates holds ONE figure per
    // company/zip/gender: rate_min and rate_max are equal on every TX row,
    // and cms_plan_g_low/high is the spread across the state's twelve
    // reference ZIPs. That is a GEOGRAPHIC range at age 65, not an age
    // range, and comparing an older band to it rejects every real
    // attained-age curve — AFLAC files $206.65 at 65 in 75201 and quotes
    // $644.37 at 90, which is 2.8x the top of the CMS spread and entirely
    // correct.
    //
    // So the filing anchors age 65, and the shape of the curve above it is
    // checked separately (the band-ratio check further down). This is the
    // same reasoning audit-medsup-provenance.mjs uses: 65 is the only band
    // the scrape covers, so it is the only band it can speak to.
    const lo = c.cms_plan_g_low, hi = c.cms_plan_g_high;
    if (age === 65 && Number.isFinite(lo) && Number.isFinite(hi)) {
      if (premium < lo * 0.6 || premium > hi * 1.8) {
        errors.push(
          `line ${line}: ${name} ${gender} ${age} = ${money(premium)} is far outside the CMS filed range ` +
          `${money(lo)}-${money(hi)}. Check for a dropped or transposed digit. Override by widening ` +
          `cms_plan_g_low/high in ${slug}-carriers.json only if the filing really changed.`,
        );
      } else if (premium < lo * 0.85 || premium > hi * 1.25) {
        warnings.push(`${name} ${gender} ${age} = ${money(premium)} sits outside the CMS range ${money(lo)}-${money(hi)}`);
      }
    }

    cells.push({ carrier: c, gender, age, premium });
  });

  // Curve sanity: an attained-age premium rises with age. A dip means two
  // cells were swapped, which no range check would catch.
  for (const c of picked) {
    for (const g of GENDERS) {
      const curve = cells.filter((x) => x.carrier.carrier_name === c.carrier_name && x.gender === g)
        .sort((a, b) => a.age - b.age);
      if (curve.length < 2) continue;
      if (String(c.rate_type).toUpperCase() === 'ATTAINED_AGE') {
        for (let i = 1; i < curve.length; i++) {
          if (curve[i].premium < curve[i - 1].premium) {
            errors.push(
              `${c.carrier_name} ${g}: ${money(curve[i].premium)} at ${curve[i].age} is LOWER than ` +
              `${money(curve[i - 1].premium)} at ${curve[i - 1].age}, but this carrier is attained-age rated. ` +
              'Two cells are probably swapped.',
            );
          }
        }
      }
      if (String(c.rate_type).toUpperCase() === 'COMMUNITY_RATED') {
        const distinct = new Set(curve.map((x) => x.premium));
        if (distinct.size > 1) {
          warnings.push(`${c.carrier_name} ${g}: community-rated but the premium varies across ages (${[...distinct].map(money).join(', ')})`);
        }
      }
      // Shape check for the bands the CMS scrape cannot anchor. A Medigap
      // attained-age premium rises, but not without limit. Across the twelve
      // TX Plan G products captured from HealthSherpa on 2026-09-19 the
      // steepest single five-year step was AFLAC's 85->90 at 1.35x, and the
      // steepest whole-curve multiple was AFLAC's 65->95 at 4.14x. A dropped
      // or transposed digit shows up here as a step well outside that. The
      // bounds are deliberately loose: this is a typo catcher, not an
      // opinion about what a carrier may file.
      const MAX_BAND_STEP = 1.6;
      const MAX_SPAN_65_95 = 6;
      for (let i = 1; i < curve.length; i++) {
        const ratio = curve[i].premium / curve[i - 1].premium;
        if (ratio > MAX_BAND_STEP) {
          errors.push(
            `${c.carrier_name} ${g}: ${money(curve[i - 1].premium)} at ${curve[i - 1].age} to ` +
            `${money(curve[i].premium)} at ${curve[i].age} is ${ratio.toFixed(2)}x across one ` +
            `five-year band (limit ${MAX_BAND_STEP}x). Check for a dropped or transposed digit.`,
          );
        }
      }
      const lowest = curve[0], highest = curve[curve.length - 1];
      if (lowest.age === 65 && highest.age === 95) {
        const span = highest.premium / lowest.premium;
        if (span > MAX_SPAN_65_95) {
          errors.push(
            `${c.carrier_name} ${g}: ${money(highest.premium)} at 95 is ${span.toFixed(2)}x the ` +
            `${money(lowest.premium)} at 65 (limit ${MAX_SPAN_65_95}x). Check the top of the curve.`,
          );
        }
      }

      const missing = AGES.filter((a) => !curve.some((x) => x.age === a));
      if (missing.length) warnings.push(`${c.carrier_name} ${g}: no premium at age ${missing.join(', ')}`);
    }
  }

  console.log(`\n${state} projection seed — ${cells.length} cell(s) from ${RATES_PATH}\n`);
  if (warnings.length) {
    console.log(`${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log('');
  }
  if (errors.length) {
    console.log(`${errors.length} error(s) — nothing was written:`);
    for (const e of errors) console.log(`  x ${e}`);
    process.exit(1);
  }
  if (!cells.length) { console.log('No filled cells. Fill the CSV first.'); process.exit(1); }

  // ── upsert carriers ──
  const carrierRows = picked.map((c) => ({
    carrier_name: c.carrier_name,
    state,
    rating_type: RATING_TYPE[String(c.rate_type ?? '').toUpperCase()] ?? null,
    am_best: c.am_best ?? null,
    naic_code: c.naic_code ?? null,
    phone: c.phone ?? null,
    website: c.website ?? null,
    active: true,
  }));

  if (!WRITE) {
    console.log('DRY RUN — nothing written. Re-run with --write to commit.\n');
    console.log(`  pm_medsup_carrier: ${carrierRows.length} row(s) upserted on (state, carrier_name)`);
    console.log(`  pm_medsup_rate:    ${cells.length} row(s) upserted on (carrier_id, plan_letter, age, gender, tobacco)`);
    for (const c of picked) {
      for (const g of GENDERS) {
        const curve = cells.filter((x) => x.carrier.carrier_name === c.carrier_name && x.gender === g).sort((a, b) => a.age - b.age);
        if (curve.length) console.log(`    ${c.carrier_name} ${g}: ${curve.map((x) => `${x.age}=${money(x.premium)}`).join('  ')}`);
      }
    }
    return;
  }

  requireCreds();
  await rest('pm_medsup_carrier?on_conflict=state,carrier_name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(carrierRows),
  });

  const ids = await rest(`pm_medsup_carrier?state=eq.${state}&select=id,carrier_name`);
  const idByName = new Map(ids.map((r) => [r.carrier_name, r.id]));

  const rateRows = cells.map((x) => ({
    carrier_id: idByName.get(x.carrier.carrier_name),
    plan_letter: PLAN,
    age: x.age,
    gender: x.gender,
    tobacco: TOBACCO,
    monthly_premium: x.premium,
    annual_premium: Math.round(x.premium * 12 * 100) / 100,
    effective_date: new Date().toISOString().slice(0, 10),
    rating_area: null,
    source: SOURCE,
    source_url: null,
  }));
  const orphan = rateRows.filter((r) => !r.carrier_id);
  if (orphan.length) { console.error(`${orphan.length} row(s) could not resolve a carrier_id — aborting.`); process.exit(1); }

  await rest('pm_medsup_rate?on_conflict=carrier_id,plan_letter,age,gender,tobacco', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rateRows),
  });

  console.log(`Wrote ${carrierRows.length} carrier(s) and ${rateRows.length} rate cell(s) for ${state}.`);
  console.log(`Next: add '${state}' to ALLOWED_STATES in api/medsup-rates.ts, and update the`);
  console.log(`underwritten-${slug} persona in qa/fixtures/personas.ts — it currently asserts the`);
  console.log('"Projection chart not available" empty state, so the sweep will go red until it is corrected.');
}

// ─── mode: --apply-cms ──────────────────────────────────────────────────────
// Every series CMS files for the state — including each carrier's separate
// underwriting tiers, which arrive as distinct `company` strings and become
// distinct pm_medsup_carrier rows. There is no seed:true filter here: the
// rule is publish every series, and a tier the applicant may be offered is
// not something this table gets to leave out.
async function applyCms() {
  if (!existsSync(CMS_PATH)) { console.error(`${CMS_PATH} not found — run scripts/scrape-medsup-projection-cms.ts first.`); process.exit(1); }
  const rows = parseCsv(readFileSync(CMS_PATH, 'utf8'));
  const header = rows.shift().map((h) => h.trim());
  const need = ['state', 'zip', 'plan_letter', 'carrier_name', 'rate_type', 'gender', 'age', 'monthly_premium'];
  if (need.some((h, i) => header[i] !== h)) { console.error(`CSV header must be: ${need.join(',')}`); process.exit(1); }
  const col = Object.fromEntries(need.map((n, i) => [n, i]));

  const errors = [], warnings = [], cells = [];
  const rateType = new Map(), zipOf = new Map(), seen = new Set();

  rows.forEach((r, idx) => {
    const line = idx + 2;
    if ((r[col.state] ?? '').trim().toUpperCase() !== state) return;
    const name = (r[col.carrier_name] ?? '').trim();
    const gender = (r[col.gender] ?? '').trim();
    const age = Number((r[col.age] ?? '').trim());
    const premium = Number((r[col.monthly_premium] ?? '').trim().replace(/[$,]/g, ''));
    const rt = (r[col.rate_type] ?? '').trim().toUpperCase();
    if ((r[col.plan_letter] ?? '').trim() !== PLAN) { errors.push(`line ${line}: plan_letter must be ${PLAN}`); return; }
    if (!GENDERS.includes(gender)) { errors.push(`line ${line}: gender "${gender}" must be M or F`); return; }
    if (!AGES.includes(age)) { errors.push(`line ${line}: age ${r[col.age]} must be one of ${AGES.join(', ')}`); return; }
    if (!Number.isFinite(premium) || premium <= 0) { errors.push(`line ${line}: premium "${r[col.monthly_premium]}" is not a positive number`); return; }
    if (!RATING_TYPE[rt]) { errors.push(`line ${line}: unknown rate_type "${rt}"`); return; }
    const prev = rateType.get(name);
    if (prev && prev !== rt) { errors.push(`line ${line}: ${name} has two rate types (${prev}, ${rt})`); return; }
    rateType.set(name, rt);
    zipOf.set(name, (r[col.zip] ?? '').trim());
    const key = `${name}|${gender}|${age}`;
    if (seen.has(key)) { errors.push(`line ${line}: duplicate cell for ${name} ${gender} ${age}`); return; }
    seen.add(key);
    cells.push({ name, gender, age, premium });
  });

  if (!cells.length) { console.error(`No ${state} rows in ${CMS_PATH}.`); process.exit(1); }
  const names = [...rateType.keys()].sort();

  // Cross-state rate_type check. rating_type is not a label — it drives the
  // disclosure ("attained-age premiums climb as you get older; issue-age ones
  // do not climb for that reason alone"), so a wrong one is a false rate
  // representation under NAIC Medigap Model Act §13, not a cosmetic slip.
  //
  // A carrier files per state and may legitimately differ. But when the SAME
  // company carries one type in one state and another elsewhere, and the
  // whole state agrees on a single value, that is the signature of a scrape
  // that lost the field — which is exactly how the first GA run came back
  // 100% ISSUE_AGE while AARP is community-rated in NC and TX. Refuse the
  // load and make someone re-check CMS.
  const elsewhere = new Map();
  for (const r of rows) {
    const st = (r[col.state] ?? '').trim().toUpperCase();
    if (!st || st === state) continue;
    const n = (r[col.carrier_name] ?? '').trim();
    if (!elsewhere.has(n)) elsewhere.set(n, new Map());
    elsewhere.get(n).set(st, (r[col.rate_type] ?? '').trim().toUpperCase());
  }
  const conflicts = [];
  for (const n of names) {
    const other = elsewhere.get(n);
    if (!other) continue;
    for (const [st, rt] of other) if (rt !== rateType.get(n)) conflicts.push(`${n}: ${state}=${rateType.get(n)} but ${st}=${rt}`);
  }
  const single = new Set(names.map((n) => rateType.get(n)));
  if (conflicts.length && single.size === 1) {
    console.log(`\n${state} CMS projection load — REFUSED\n`);
    console.log(`Every one of the ${names.length} ${state} series carries rate_type ${[...single][0]}, and ${conflicts.length} of them`);
    console.log('contradict the same company in another state. A whole state agreeing on one value is what a');
    console.log('dropped field looks like, and rating_type drives the disclosure — loading it would put a false');
    console.log('rate representation on a consumer screen. Re-scrape ' + state + ' and confirm rate_type against CMS.\n');
    for (const c of conflicts.slice(0, 12)) console.log(`  x ${c}`);
    if (conflicts.length > 12) console.log(`  ... and ${conflicts.length - 12} more`);
    process.exit(1);
  }
  for (const c of conflicts) warnings.push(`rate_type differs across states — ${c}`);

  // Same curve checks as --apply. The CMS range cross-check is deliberately
  // NOT run: it compares against pm_supp_carrier_rates, which is the same
  // CMS scrape, so it would only be checking this file against itself.
  for (const name of names) {
    const rt = rateType.get(name);
    for (const g of GENDERS) {
      const curve = cells.filter((x) => x.name === name && x.gender === g).sort((a, b) => a.age - b.age);
      if (!curve.length) continue;
      if (rt === 'ATTAINED_AGE') {
        for (let i = 1; i < curve.length; i++) {
          if (curve[i].premium < curve[i - 1].premium) {
            errors.push(`${name} ${g}: ${money(curve[i].premium)} at ${curve[i].age} is LOWER than ${money(curve[i - 1].premium)} at ${curve[i - 1].age} on an attained-age filing.`);
          }
        }
      }
      // Warn, never fail: CMS itself returns community-rated filings whose
      // premium varies by age. That contradiction is in the source of truth,
      // so the loader reports it and loads what CMS says. See
      // scripts/check-rating-shape.mjs.
      if (rt === 'COMMUNITY_RATED' && new Set(curve.map((x) => x.premium)).size > 1) {
        warnings.push(`${name} ${g}: CMS calls this community-rated but the premium varies by age`);
      }
      for (let i = 1; i < curve.length; i++) {
        const ratio = curve[i].premium / curve[i - 1].premium;
        if (ratio > 1.6) errors.push(`${name} ${g}: ${money(curve[i - 1].premium)} at ${curve[i - 1].age} to ${money(curve[i].premium)} at ${curve[i].age} is ${ratio.toFixed(2)}x across one band.`);
      }
      const lo = curve[0], hi = curve[curve.length - 1];
      if (lo.age === 65 && hi.age === 95 && hi.premium / lo.premium > 6) {
        errors.push(`${name} ${g}: ${money(hi.premium)} at 95 is ${(hi.premium / lo.premium).toFixed(2)}x the ${money(lo.premium)} at 65.`);
      }
      const missing = AGES.filter((a) => !curve.some((x) => x.age === a));
      if (missing.length) warnings.push(`${name} ${g}: CMS files no premium at age ${missing.join(', ')}`);
    }
  }

  console.log(`\n${state} CMS projection load — ${names.length} series, ${cells.length} cell(s) from ${CMS_PATH}\n`);
  if (warnings.length) { console.log(`${warnings.length} warning(s):`); for (const w of warnings) console.log(`  ! ${w}`); console.log(''); }
  if (errors.length) { console.log(`${errors.length} error(s) — nothing was written:`); for (const e of errors) console.log(`  x ${e}`); process.exit(1); }

  // phone/website/naic_code/am_best are deliberately NOT in this payload.
  // PostgREST merge-duplicates writes every column it is given, so sending
  // them as null would blank whatever is already on the row. Omitted columns
  // are left alone. (Same defect class as the scraped_at bug in
  // seed-carrier-rates.mjs — a DEFAULT/existing value only survives if the
  // column is absent from the request body.)
  const carrierRows = names.map((n) => ({
    carrier_name: n, state, rating_type: RATING_TYPE[rateType.get(n)], active: true,
  }));

  if (!WRITE) {
    console.log('DRY RUN — nothing written. Re-run with --write to commit.\n');
    console.log(`  pm_medsup_carrier: ${carrierRows.length} row(s) upserted on (state, carrier_name)`);
    console.log(`  pm_medsup_rate:    ${cells.length} row(s) upserted on (carrier_id, plan_letter, age, gender, tobacco), source='${SOURCE_CMS}'`);
    const byType = {};
    for (const n of names) { const t = RATING_TYPE[rateType.get(n)]; byType[t] = (byType[t] ?? 0) + 1; }
    console.log(`  rating types:      ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    for (const n of names) {
      const c = cells.filter((x) => x.name === n && x.gender === 'F').sort((a, b) => a.age - b.age);
      if (c.length) console.log(`    ${n} F: ${c.map((x) => `${x.age}=${money(x.premium)}`).join('  ')}`);
    }
    return;
  }

  requireCreds();
  await rest('pm_medsup_carrier?on_conflict=state,carrier_name', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(carrierRows),
  });
  const ids = await rest(`pm_medsup_carrier?state=eq.${state}&select=id,carrier_name`);
  const idByName = new Map(ids.map((r) => [r.carrier_name, r.id]));
  const rateRows = cells.map((x) => ({
    carrier_id: idByName.get(x.name),
    plan_letter: PLAN, age: x.age, gender: x.gender, tobacco: TOBACCO,
    monthly_premium: x.premium,
    annual_premium: Math.round(x.premium * 12 * 100) / 100,
    effective_date: new Date().toISOString().slice(0, 10),
    rating_area: null,
    source: SOURCE_CMS,
    source_url: cmsUrl(state, zipOf.get(x.name), x.age, x.gender),
  }));
  const orphan = rateRows.filter((r) => !r.carrier_id);
  if (orphan.length) { console.error(`${orphan.length} row(s) could not resolve a carrier_id — aborting.`); process.exit(1); }
  await rest('pm_medsup_rate?on_conflict=carrier_id,plan_letter,age,gender,tobacco', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rateRows),
  });
  console.log(`Wrote ${carrierRows.length} carrier(s) and ${rateRows.length} CMS rate cell(s) for ${state}.`);
  console.log('This does NOT retire the superseded healthsherpa rows — run');
  console.log(`  node scripts/seed-medsup-projection.mjs --supersede ${state}`);
  console.log('to print the archive-then-delete SQL for them. Nothing is deleted automatically.');
}

// ─── mode: --supersede ──────────────────────────────────────────────────────
// Once CMS rows are in, the hand-entered curve for the same product is a
// second series for one policy — one of them stale. Which stored row answers
// to which CMS series is a naming judgement, not something to infer at
// runtime: "Cigna National Health Insurance Company" is CMS "HealthSpring
// Insurance Company" in NC but TX stores that same company under its own
// name, so a global alias table gets it wrong. The map is therefore explicit,
// per state, and reviewed. A null means CMS files nothing equivalent and the
// stored row stays.
//
// This mode PRINTS SQL. It does not execute anything.
// Only carriers CMS files under a DIFFERENT name are listed here. Where the
// stored name already equals the CMS name, the --apply-cms upsert has already
// corrected those cells in place on the same carrier row — deleting anything
// there would delete the CMS data that just landed. A null means CMS files
// nothing equivalent and the stored row stays.
//
// The mapping is explicit and per state because a global alias table gets it
// wrong: NC stores HealthSpring as "Cigna National Health Insurance Company"
// while TX stores that same company under its own name. Applied 2026-09-21:
// 96 NC rows and 14 TX rows moved to pm_medsup_rate_archive_20260921.
const SUPERSEDED = {
  NC: {
    'AARP/UnitedHealthcare Insurance Company': 'AARP - UnitedHealthcare Insurance Company (Standard)',
    'AARP/UnitedHealthcare Insurance Company of America': 'AARP - UnitedHealthcare Insurance Company of America (Standard)',
    'AARP/UnitedHealthcare Insurance Company (Select)': null, // CMS files no Select network in NC
    'Aflac': 'AFLAC',
    'Blue Medicare Supplement (BCBSNC)': 'BlueCross BlueShield of North Carolina',
    'Cigna National Health Insurance Company': 'HealthSpring Insurance Company',
    'Humana Achieve Medicare Supplement': 'Humana Achieve (CompBenefits Insurance Company)',
    'Humana Medicare Supplement': 'Humana (Humana Benefit Plan of Illinois, Inc.)',
    // The stored curve is CMS Medico Preferred x 0.81634 at every band — a
    // derived number no carrier filed. CMS files three real tiers instead.
    'Medico Insurance Company': 'Medico Insurance Company (Preferred)',
    'Physicians Select Insurance Company (PSIC)': null,             // suppressed by migration 005
    'Physicians Select Insurance Company (PSIC) - Innovative': null, // suppressed by migration 005
  },
  TX: {
    'BlueCross BlueShield of Texas (Plan G)': 'BlueCross BlueShield of Texas',
    'BlueCross BlueShield of Texas (Plan G Select)': null, // CMS files no Select network in TX
  },
};

function supersede() {
  const map = SUPERSEDED[state];
  if (!map) { console.error(`No supersede map for ${state}. Add one only after checking each name against CMS by hand.`); process.exit(1); }
  const retire = Object.entries(map).filter(([, v]) => v).map(([k]) => k);
  const keep = Object.entries(map).filter(([, v]) => !v).map(([k]) => k);
  const lit = (x) => `'${x.replace(/'/g, "''")}'`;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log(`-- Retire ${state} hand-entered projection rows that CMS now supersedes.`);
  console.log('-- Generated by scripts/seed-medsup-projection.mjs --supersede. Review before running.');
  console.log(`-- ${retire.length} carrier(s) retired, ${keep.length} kept (no CMS counterpart).`);
  for (const [k, v] of Object.entries(map)) console.log(`--   ${v ? 'RETIRE' : 'KEEP  '}  ${k}${v ? `  ->  ${v}` : ''}`);
  console.log('');
  console.log('begin;');
  console.log('');
  console.log(`create table if not exists pm_medsup_rate_archive_${stamp} as`);
  console.log('  select r.*, c.carrier_name, c.state');
  console.log('    from pm_medsup_rate r join pm_medsup_carrier c on c.id = r.carrier_id');
  console.log(`   where c.state = '${state}'`);
  console.log(`     and c.carrier_name in (${retire.map(lit).join(', ')});`);
  console.log('');
  console.log('-- Expected archive count is printed by the dry run above; check it before deleting.');
  console.log('delete from pm_medsup_rate r');
  console.log('  using pm_medsup_carrier c');
  console.log(' where c.id = r.carrier_id');
  console.log(`   and c.state = '${state}'`);
  console.log(`   and c.carrier_name in (${retire.map(lit).join(', ')});`);
  console.log('');
  console.log('-- Carrier rows are left in place: deactivate only the ones that now have no');
  console.log('-- rates at all, so a carrier never disappears from the board silently.');
  console.log('update pm_medsup_carrier c set active = false, updated_at = now()');
  console.log(` where c.state = '${state}'`);
  console.log(`   and c.carrier_name in (${retire.map(lit).join(', ')})`);
  console.log('   and not exists (select 1 from pm_medsup_rate r where r.carrier_id = c.id);');
  console.log('');
  console.log('commit;');
}

// ─── go ─────────────────────────────────────────────────────────────────────
try {
  if (mode === '--init-carriers') await initCarriers();
  else if (mode === '--template') template();
  else if (mode === '--apply-cms') await applyCms();
  else if (mode === '--supersede') supersede();
  else await apply();
} catch (e) {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
}
