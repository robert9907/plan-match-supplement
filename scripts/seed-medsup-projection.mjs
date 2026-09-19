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
if (!state || !['--init-carriers', '--template', '--apply'].includes(mode)) {
  console.error('usage: seed-medsup-projection.mjs --init-carriers|--template|--apply <STATE> [--write]');
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

    // The cross-check that earns this script its keep. The CMS filed range
    // for this carrier is independent data. A hand-typed premium far outside
    // it is a transcription error far more often than it is a real rate.
    const lo = c.cms_plan_g_low, hi = c.cms_plan_g_high;
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
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

// ─── go ─────────────────────────────────────────────────────────────────────
try {
  if (mode === '--init-carriers') await initCarriers();
  else if (mode === '--template') template();
  else await apply();
} catch (e) {
  console.error(`\nFailed: ${e.message}`);
  process.exit(1);
}
