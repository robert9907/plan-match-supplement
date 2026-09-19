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
