#!/usr/bin/env node
// ---------------------------------------------------------------------------
// audit-medsup-provenance.mjs — does every projection premium belong to the
// carrier it is shown under?
//
//   node scripts/audit-medsup-provenance.mjs NC
//   node scripts/audit-medsup-provenance.mjs NC TX GA
//
// Why this exists
// ---------------
// pm_medsup_rate drives the 20-year projection chart. pm_supp_carrier_rates
// holds the CMS Plan Finder scrape. The two are seeded separately and share
// no key — pm_medsup_carrier carries a name and a rating type, and for North
// Carolina all 15 rows were loaded on 2026-06-13 with no NAIC code, no phone
// and no website. On 2026-09-19 that let three figures sit under the wrong
// name:
//
//   GPM Health and Life Insurance Company shows $179.69 at age 65 male.
//   GPM's own filed NC male rate is $312.66 at all twelve reference ZIPs.
//   $179.69 is AFLAC's filed NC male rate at 27713.
//
//   Aflac shows $318.83. AFLAC's filed male rate tops out at $179.69.
//   $318.83 is within 2% of GPM's $312.66. The two look transposed.
//
//   AHIC shows $212.34, Mutual of Omaha (Omaha Insurance Company)'s filed NC
//   male rate to the cent. "AHIC" matches no company CMS lists in NC.
//
// Each is a wrong premium on a consumer screen by 43% to 78%, and none of
// them is visible from inside the projection: the curves rise smoothly and
// look entirely reasonable. They are only visible against the filings.
//
// How it matches
// --------------
// NOT by name. The two tables genuinely disagree about names for carriers
// that are fine — the projection's "Cigna National Health Insurance Company"
// files with CMS as "HealthSpring Insurance Company", and "Blue Medicare
// Supplement (BCBSNC)" files as "BlueCross BlueShield of North Carolina".
// Matching on names alone reports those as defects, which is noise, and
// worse, it trains you to skim the output.
//
// So it works the other way round: take the age-65 premium and ask which
// filed companies could have produced it. Then check whether the name it is
// shown under is one of them.
//
//   ok            the stated name is among the companies that filed that
//                 figure, directly or through an entry in the alias file
//   NEEDS A NAME  exactly one company filed it and it is not the stated one,
//                 with no alias on record — either an alias you should add,
//                 or the defect this script is for
//   MISMATCH      no company in the state filed that figure at all
//
// Confirmed aliases live in data/medsup-projection/carrier-aliases.json so a
// second run is quiet. Adding one is a claim that two names are the same
// company — make it from the filing, not from the fact that the numbers
// happen to agree.
//
// Age 65 is the anchor because it is the only band the scrape covers. A
// carrier whose age-65 figure is right can still have a wrong curve above it.
// This catches the class where a whole series was attributed to the wrong
// company, which is the one that has actually happened.
//
// Exit 1 on anything unresolved. Read-only: it never writes.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or .env.local in cwd.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=("?)([^"\n]*)\2$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
  }
}

const URL_BASE = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!URL_BASE || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (or .env.local).');
  process.exit(1);
}
// Same guard as the seeders: pm_medsup_* lives in plan-match-prod and nowhere
// else, and pointing this at the CRM would compare unrelated tables.
if (!/rpcbrkmvalvdmroqzpaq/.test(URL_BASE)) {
  console.error(`SUPABASE_URL is ${URL_BASE}`);
  console.error('pm_medsup_* lives in plan-match-prod (rpcbrkmvalvdmroqzpaq). Refusing to run.');
  process.exit(1);
}

const states = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
if (states.length === 0) {
  console.error('Usage: node scripts/audit-medsup-provenance.mjs NC [TX GA]');
  process.exit(1);
}

const ALIAS_PATH = 'data/medsup-projection/carrier-aliases.json';
let aliases = {};
if (existsSync(ALIAS_PATH)) {
  try {
    const raw = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
    aliases = raw.aliases ?? raw;
  } catch (err) {
    console.error(`${ALIAS_PATH} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

async function rest(path) {
  const resp = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
  });
  if (!resp.ok) {
    console.error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    process.exit(1);
  }
  return resp.json();
}

/** Loose enough that "Mutual of Omaha" reaches "Mutual of Omaha (Omaha Insurance Company)". */
function normalize(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(insurance|assurance|life|health|and|of|the|company|co|inc|corporation|corp|llc)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

const money = (n) => `$${Number(n).toFixed(2)}`;
const EPS = 0.005;

let unresolved = 0;
const suggestions = [];

for (const state of states) {
  console.log(`\n${'─'.repeat(72)}\n${state}\n${'─'.repeat(72)}`);

  const carriers = await rest(
    `pm_medsup_carrier?select=id,carrier_name,naic_code&state=eq.${state}&active=eq.true`,
  );
  if (carriers.length === 0) {
    console.log('  no projection carriers on record — nothing to audit');
    continue;
  }
  const byId = new Map(carriers.map((c) => [c.id, c]));

  const rates = await rest(
    `pm_medsup_rate?select=carrier_id,gender,monthly_premium&plan_letter=eq.G&age=eq.65&tobacco=eq.false`,
  );
  const filings = await rest(
    `pm_supp_carrier_rates?select=company,gender,rate_min&plan=eq.G&state=eq.${state}`,
  );
  if (filings.length === 0) {
    console.log('  no CMS filings on record for this state — cannot audit');
    unresolved++;
    continue;
  }

  // company -> gender -> {lo, hi}
  const filed = new Map();
  for (const f of filings) {
    const g = String(f.gender).toUpperCase().startsWith('F') ? 'F' : 'M';
    const v = Number(f.rate_min);
    if (!Number.isFinite(v)) continue;
    if (!filed.has(f.company)) filed.set(f.company, { M: null, F: null });
    const e = filed.get(f.company);
    if (!e[g]) e[g] = { lo: v, hi: v };
    else {
      e[g].lo = Math.min(e[g].lo, v);
      e[g].hi = Math.max(e[g].hi, v);
    }
  }

  if (carriers.every((c) => !c.naic_code)) {
    console.log(
      `  note: none of the ${carriers.length} carriers carries a NAIC code, so nothing\n` +
      '        but the premium itself links a projection row to a filing.\n',
    );
  }

  for (const r of rates) {
    const carrier = byId.get(r.carrier_id);
    if (!carrier) continue;
    const gender = String(r.gender).toUpperCase().startsWith('F') ? 'F' : 'M';
    const premium = Number(r.monthly_premium);
    if (!Number.isFinite(premium)) continue;

    const stated = carrier.carrier_name;
    const label = `${stated} ${gender} 65 = ${money(premium)}`;

    const candidates = [];
    for (const [company, e] of filed) {
      const range = e[gender];
      if (range && premium >= range.lo - EPS && premium <= range.hi + EPS) candidates.push(company);
    }

    if (candidates.length === 0) {
      unresolved++;
      console.log(`  MISMATCH      ${label}`);
      console.log('                no company filed this figure in this state for this gender');
      const own = [...filed.entries()].find(([c]) => normalize(c) === normalize(stated));
      if (own && own[1][gender]) {
        const { lo, hi } = own[1][gender];
        const spread = lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
        console.log(`                its own filing is ${spread}`);
      }
      continue;
    }

    const accepted = new Set([normalize(stated), ...(aliases[stated] ?? []).map(normalize)]);
    if (candidates.some((c) => accepted.has(normalize(c)))) continue;

    unresolved++;
    console.log(`  NEEDS A NAME  ${label}`);
    console.log(`                filed by: ${candidates.join(', ')}`);
    const own = [...filed.entries()].find(([c]) => normalize(c) === normalize(stated));
    if (own && own[1][gender]) {
      const { lo, hi } = own[1][gender];
      const spread = lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
      const off = Math.round(((premium - lo) / lo) * 100);
      console.log(`                but "${stated}" filed ${spread} (${off > 0 ? '+' : ''}${off}%)`);
      console.log('                two different companies. This is the defect, not an alias.');
    } else if (candidates.length === 1) {
      suggestions.push(`  "${stated}": ["${candidates[0]}"]`);
      console.log(`                "${stated}" filed nothing under that name — alias, or wrong name`);
    }
  }
}

console.log('');
if (suggestions.length > 0) {
  console.log(`If those are the same company, record it in ${ALIAS_PATH}:\n`);
  console.log('{\n  "aliases": {');
  console.log([...new Set(suggestions)].join(',\n'));
  console.log('  }\n}\n');
  console.log('Confirm each one against the filing. Matching numbers are not evidence');
  console.log('of a shared identity — that is the assumption this script exists to test.\n');
}

if (unresolved > 0) {
  console.log(`FAIL: ${unresolved} age-65 premium(s) could not be tied to the carrier shown.\n`);
  process.exit(1);
}
console.log("PASS: every age-65 projection premium was filed by the carrier it is shown under.\n");
