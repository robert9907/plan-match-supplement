// scripts/_test-enroll-schema-supplement.ts
//
// Schema-validation test for supplement /api/enroll → AgentBase.
// See consumer's variant for full rationale — this is the same test
// with the supplement-specific expected columns per table.
//
// Run: npx tsx scripts/_test-enroll-schema-supplement.ts

import { readFileSync, existsSync } from 'node:fs';

for (const file of ['.env.probe', '.env.local']) {
  if (existsSync(file)) {
    for (const raw of readFileSync(file, 'utf8').split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

const URL_STR = process.env.AGENTBASE_SUPABASE_URL ?? '';
const KEY = process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!URL_STR || !KEY) {
  console.error('Missing AGENTBASE_SUPABASE_URL / AGENTBASE_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const BASE = URL_STR.replace(/\/$/, '');
const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: 'application/json',
};

// Every column supplement /api/enroll writes to, grouped by table.
// SOURCE: ~/Desktop/plan-match-supplement/api/enroll.ts as of this commit.
const EXPECTED: Record<string, string[]> = {
  clients: [
    // Written by clients upsert (INSERT + PATCH share clientColumns)
    'first_name',
    'last_name',
    'phone',
    'email',
    'dob',
    'address',
    'city',
    'state',
    'zip',
    'county',
    'medicare_id',
    'carrier',
    'plan_name',
    'part_a_month',
    'part_a_year',
    'part_b_month',
    'part_b_year',
    'sex',
    'height_inches',
    'weight_lbs',
    'bmi', // mig 045
    'tobacco_user',
    'medicaid_eligible', // mig 043
    'enrollment_reason',
    'enrollment_period',
    'sep_reason_code',
    'sep_effective_date',
    'lead_source',
    // Read
    'id',
    'deleted_at', // soft-delete filter + tombstone guard
    'created_at',
    'updated_at',
  ],
  leads: [
    'first_name',
    'last_name',
    'phone',
    'email',
    'county',
    'age',
    'source',
    'product',
    'context',
    'deleted_at',
    'id',
    'created_at',
  ],
  providers: [
    'name',
    'npi',
    'specialty',
    'affiliation',
    'id',
    'created_at',
  ],
  client_providers: [
    'client_id',
    'provider_id',
    'synced_from_planmatch_at',
    'id',
    'created_at',
  ],
};

async function fetchColumns(table: string): Promise<Set<string>> {
  const resp = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=1`, {
    headers: HEADERS,
  });
  if (!resp.ok) {
    throw new Error(`GET ${table} → ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const rows = (await resp.json()) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    console.warn(`  [warn] ${table} returned 0 rows — cannot introspect columns`);
    return new Set();
  }
  return new Set(Object.keys(rows[0]));
}

async function main(): Promise<void> {
  console.log('=== supplement /api/enroll schema-validation ===');
  console.log('AgentBase:', URL_STR);
  console.log();

  let failed = 0;
  for (const [table, expected] of Object.entries(EXPECTED)) {
    console.log(`── ${table} ──`);
    let actual: Set<string>;
    try {
      actual = await fetchColumns(table);
    } catch (err) {
      console.error(`  ❌ fetch failed:`, err instanceof Error ? err.message : err);
      failed += 1;
      continue;
    }
    const missing = expected.filter((c) => !actual.has(c));
    if (missing.length === 0) {
      console.log(`  ✅ all ${expected.length} expected columns present`);
    } else {
      console.error(`  ❌ MISSING ${missing.length}: ${missing.join(', ')}`);
      failed += 1;
    }
  }

  console.log();
  if (failed === 0) {
    console.log('✅ PASS — supplement enroll writes align with AgentBase schema');
    process.exit(0);
  } else {
    console.error(`❌ FAIL — ${failed} table(s) have schema drift`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('threw:', err);
  process.exit(1);
});
