#!/usr/bin/env node
// Seed pm_supp_carrier_rates from the CMS Plan Finder CSV scrape.
//
// Idempotent: uses Prefer: resolution=merge-duplicates with the
// (state, zip, plan, gender, company) uniqueness constraint, so re-runs
// over a refreshed CSV update existing rows in place.
//
// Run with:
//   node scripts/seed-carrier-rates.mjs path/to/medigap_G_N_all.csv
// Defaults to ~/Downloads/medigap_G_N_all.csv when no path is passed.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or .env.local in cwd).

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// ─── .env.local loader (no dotenv dep) ────────────────────────────
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
  console.error('Either export them or put them in .env.local.');
  process.exit(1);
}

const csvPath = resolve(
  process.argv[2] ?? `${homedir()}/Downloads/medigap_G_N_all.csv`,
);
if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

// ─── CSV parser (handles quoted fields with embedded commas) ──────
function parseCsv(text) {
  const rows = [];
  let i = 0;
  let cur = '';
  let field = [];
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      field.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      field.push(cur);
      rows.push(field);
      field = [];
      cur = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur || field.length) {
    field.push(cur);
    rows.push(field);
  }
  return rows;
}

const num = (s) => {
  if (s == null || s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

console.log(`Reading CSV: ${csvPath}`);
const csv = readFileSync(csvPath, 'utf8');
const rows = parseCsv(csv);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));

const records = [];
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  if (row.length < 13) continue;
  const rateMin = num(row[idx.rate_min]);
  const rateMax = num(row[idx.rate_max]);
  if (rateMin == null && rateMax == null) continue;
  records.push({
    state: row[idx.state],
    zip: row[idx.zip],
    plan: row[idx.plan],
    gender: row[idx.gender],
    company: row[idx.company],
    rate_type: row[idx.rate_type],
    rate_min: rateMin ?? rateMax,
    rate_max: rateMax,
    hhd_std_min: num(row[idx.hhd_std_min]),
    hhd_std_max: num(row[idx.hhd_std_max]),
    hhd_rm_min: num(row[idx.hhd_rm_min]),
    hhd_rm_max: num(row[idx.hhd_rm_max]),
    phone: row[idx.phone] || null,
    website: row[idx.website] || null,
    address: row[idx.address] || null,
    // Must be set explicitly: PostgREST merge-duplicates writes only the
    // columns supplied, so the column DEFAULT fires on INSERT and never on
    // UPDATE. Omitting this left 3,928 refreshed rows stamped 2026-06-12.
    scraped_at: new Date().toISOString(),
  });
}

// ─── Household-premium sanity check ────────────────────────────────
//
// hhd_std_min / hhd_rm_min are the monthly premium under the carrier's
// household form, so they belong BELOW rate_min. Across the rows already
// loaded they sit at 0.877-1.0 of it.
//
// HealthSpring does not: it lands at exactly 1.740x rate_min in all 192 of
// its rows across NC and TX, every row, both entities, both genders. A
// constant to three decimals is not a scrape of independent figures — it is
// a derived relationship, and 1.740 is 2 x 0.87. The likely reading is that
// medicare.gov quotes HealthSpring's household figure as the COMBINED
// premium for two people at a 13% discount each, where every other carrier
// quotes it per person. That has not been confirmed against the source page,
// so nothing here divides by two — guessing a premium is the failure mode
// this whole check exists to prevent.
//
// Downstream, scoringEngine's discountCopy suppresses the household line
// when the premium is not below the rate, so a bad value cannot reach a
// screen. This check is so it cannot enter the database unnoticed either.
const anomalies = records.filter((r) => {
  const hhd = r.hhd_rm_min ?? r.hhd_std_min;
  return hhd != null && r.rate_min != null && hhd >= r.rate_min;
});

if (anomalies.length > 0) {
  const byCompany = new Map();
  for (const a of anomalies) {
    const hhd = a.hhd_rm_min ?? a.hhd_std_min;
    const ratio = hhd / a.rate_min;
    const e = byCompany.get(a.company) ?? { n: 0, lo: Infinity, hi: -Infinity, states: new Set() };
    e.n++;
    e.lo = Math.min(e.lo, ratio);
    e.hi = Math.max(e.hi, ratio);
    e.states.add(a.state);
    byCompany.set(a.company, e);
  }
  console.error(`\nHousehold premium is not below the standard rate in ${anomalies.length} row(s):`);
  for (const [company, e] of [...byCompany.entries()].sort((a, b) => b[1].n - a[1].n)) {
    const range = e.lo.toFixed(3) === e.hi.toFixed(3)
      ? `${e.lo.toFixed(3)}x`
      : `${e.lo.toFixed(3)}-${e.hi.toFixed(3)}x`;
    console.error(`  ${e.n.toString().padStart(4)}  ${range.padEnd(14)} ${company} [${[...e.states].sort().join(',')}]`);
  }
  console.error('\nA household premium at or above the standard rate is not a discount.');
  console.error('Check the source CSV against the medicare.gov page for those carriers');
  console.error('before loading. To load anyway, re-run with --allow-hhd-anomalies.\n');
  if (!process.argv.includes('--allow-hhd-anomalies')) process.exit(1);
  console.error('--allow-hhd-anomalies set; loading them as-is.\n');
}

console.log(`Parsed ${records.length} rows; upserting in batches…`);

const BATCH = 500;
const base = SUPABASE_URL.replace(/\/$/, '');
const endpoint = `${base}/rest/v1/pm_supp_carrier_rates?on_conflict=state,zip,plan,gender,company`;

let upserted = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const chunk = records.slice(i, i + BATCH);
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      // merge-duplicates upserts; matches uq_carrier_rate.
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(chunk),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Batch ${i / BATCH + 1} failed ${resp.status}: ${text.slice(0, 500)}`);
    process.exit(1);
  }
  upserted += chunk.length;
  process.stdout.write(`\r  ${upserted} / ${records.length}`);
}
process.stdout.write('\n');
console.log(`Done. ${upserted} rows upserted into pm_supp_carrier_rates.`);

// ─── Retirement check ─────────────────────────────────────────────
//
// This upsert is merge-only: it updates and inserts, never deletes. A
// carrier that stops filing in a state, or files under a new name, leaves
// its old rows behind serving the last price we ever saw. That is how 264
// rows survived from 2026-06-12 to 2026-09-20 — two of them duplicating a
// live carrier under a dead name, at a stale price, on the results page.
//
// So after every load, name what the scrape did not cover. Detection only:
// removing consumer rows stays a deliberate, reviewed step.

async function getAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const resp = await fetch(`${base}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + 999}`,
      },
    });
    if (!resp.ok) {
      console.error(`Retirement check failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return null;
    }
    const page = await resp.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const statesLoaded = [...new Set(records.map((r) => r.state))].sort();
const inCsv = new Set(records.map((r) => `${r.state}\u0000${r.company}`));
const live = await getAll(
  `pm_supp_carrier_rates?select=state,company&state=in.(${statesLoaded.join(',')})`,
);

if (live) {
  const orphans = new Map();
  for (const row of live) {
    const key = `${row.state}\u0000${row.company}`;
    if (inCsv.has(key)) continue;
    orphans.set(key, (orphans.get(key) ?? 0) + 1);
  }

  if (orphans.size === 0) {
    console.log(`Retirement check: every (state, company) in ${statesLoaded.join('/')} was covered by this scrape.`);
  } else {
    const total = [...orphans.values()].reduce((a, b) => a + b, 0);
    console.log(
      `\nRetirement check: ${total} row(s) across ${orphans.size} (state, company) pair(s) are in the\n` +
      `table but NOT in this scrape. They still carry whatever price they last had:\n`,
    );
    const pairs = [...orphans.entries()]
      .map(([k, n]) => { const [st, co] = k.split('\u0000'); return { st, co, n }; })
      .sort((a, b) => a.st.localeCompare(b.st) || a.co.localeCompare(b.co));
    for (const { st, co, n } of pairs) console.log(`  ${st}  ${String(n).padStart(4)}  ${co}`);
    console.log(
      '\nCheck each one before acting: a pair can be absent because the carrier left the\n' +
      'state, because it now files under a different name (the old and new names then both\n' +
      'appear on the results page at different prices), or because the scrape itself is\n' +
      'incomplete. Confirm against the raw capture, not against this list.\n' +
      '\nTo retire the ones you have confirmed, archive then delete:\n' +
      '\n  insert into pm_supp_carrier_rates_retired' +
      '\n  select r.*, current_date, \'<why>\' from pm_supp_carrier_rates r' +
      `\n  where (r.state, r.company) in (${pairs.map(({ st, co }) => `('${st}','${co.replace(/'/g, "''")}')`).join(', ')});` +
      '\n\n  delete from pm_supp_carrier_rates' +
      `\n  where (state, company) in (${pairs.map(({ st, co }) => `('${st}','${co.replace(/'/g, "''")}')`).join(', ')});\n`,
    );
  }
}
