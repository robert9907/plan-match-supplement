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
