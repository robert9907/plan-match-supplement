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
//   declared      the premium is outside every filed range, but this carrier
//                 declares itself a named policy form of a company that IS
//                 filed, within a recorded allowance. Reported, never silent.
//   NEEDS A NAME  exactly one company filed it and it is not the stated one,
//                 with no alias on record — either an alias you should add,
//                 or the defect this script is for
//   MISMATCH      no company in the state filed that figure at all
//
// Confirmed aliases live in data/medsup-projection/carrier-aliases.json so a
// second run is quiet. Adding one is a claim that two names are the same
// company — make it from the filing, not from the fact that the numbers
// happen to agree. They are keyed by state, because carrier_name is only
// unique per (state, carrier_name): NC files HealthSpring under "Cigna
// National Health Insurance Company" and TX carries it under its own name,
// and a state-blind key cannot say that.
//
// Why "declared" exists
// ---------------------
// pm_supp_carrier_rates carries one figure per COMPANY. A quoting tool sells
// a FORM, and a company can have several. BlueCross BlueShield of Texas files
// one Plan G figure with CMS and HealthSherpa quotes two products; Mutual of
// Omaha's MM25H sits above the range its company filed. Neither is a wrong
// premium under a real carrier's name, which is what this script is for, so
// failing them teaches you to skim the output — the one outcome that would
// make the script worse than nothing.
//
// The escape is deliberately narrow. A declaration names the CMS company, a
// maximum offset from its filed range, why the offset exists, and what the
// figure came from. Any field missing, or an offset over 40%, is itself a
// failure — you cannot wave a row through by writing less. Every declaration
// used is printed, with the offset it consumed, and if the premium ALSO
// falls inside some other company's range that is printed too: that is the
// NC failure mode, and a declaration must not hide it.
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
let forms = {};
if (existsSync(ALIAS_PATH)) {
  try {
    const raw = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
    aliases = raw.aliases ?? raw;
    forms = raw.forms ?? {};
    // Aliases are keyed by state, same as forms. They were flat until
    // 2026-09-21; carrier_name is only unique per (state, carrier_name), so a
    // flat key silently applied in every state at once. Fail loudly rather
    // than accepting both shapes - a half-migrated file is the ambiguity.
    const flat = Object.entries(aliases).filter(([, v]) => Array.isArray(v));
    if (flat.length) {
      console.error(`${ALIAS_PATH} uses the old flat alias shape.`);
      console.error('Aliases are now keyed by state first, like forms:');
      console.error(`  "aliases": { "NC": { ${JSON.stringify(flat[0][0])}: ${JSON.stringify(flat[0][1])} } }`);
      console.error('Move each entry under the state whose pm_medsup_carrier row it names.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`${ALIAS_PATH} is not valid JSON: ${err.message}`);
    process.exit(1);
  }
}

/** The most an offset may ever be allowed to be, whatever a declaration asks for. */
const MAX_DECLARED_OFFSET_PCT = 40;

/**
 * What is wrong with this declaration, or null if nothing is. A declaration
 * that omits its reasoning is not a weaker declaration, it is not one.
 */
function declarationProblem(d) {
  if (typeof d?.cms_company !== 'string' || !d.cms_company.trim()) return 'cms_company is missing';
  const pct = d.max_offset_pct;
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0) return 'max_offset_pct must be a non-negative number';
  if (pct > MAX_DECLARED_OFFSET_PCT) return `max_offset_pct ${pct} exceeds the ${MAX_DECLARED_OFFSET_PCT}% ceiling`;
  if (typeof d.why !== 'string' || d.why.trim().length < 40) return 'why must say, in a sentence or more, what the form is';
  if (typeof d.evidence !== 'string' || d.evidence.trim().length < 20) return 'evidence must say where the figure came from';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.verified_on ?? ''))) return 'verified_on must be YYYY-MM-DD';
  return null;
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
const declaredUsed = [];

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

    const accepted = new Set([
      normalize(stated),
      ...((aliases[state] ?? {})[stated] ?? []).map(normalize),
    ]);
    if (candidates.some((c) => accepted.has(normalize(c)))) continue;

    // A declared policy form of a company that IS filed. Narrow on purpose:
    // see the header. Checked before MISMATCH and before NEEDS A NAME,
    // because a form offset explains both shapes.
    const decl = (forms[state] ?? {})[stated];
    if (decl) {
      const problem = declarationProblem(decl);
      if (problem) {
        unresolved++;
        console.log(`  BAD DECLARE   ${label}`);
        console.log(`                the declaration in ${ALIAS_PATH} is not usable: ${problem}`);
        continue;
      }
      const own = filed.get(decl.cms_company);
      const range = own?.[gender];
      if (!range) {
        unresolved++;
        console.log(`  BAD DECLARE   ${label}`);
        console.log(`                declares the form of "${decl.cms_company}", which filed nothing`);
        console.log('                in this state for this gender. Check the company name.');
        continue;
      }
      const tol = decl.max_offset_pct / 100;
      const inside = premium >= range.lo - EPS && premium <= range.hi + EPS;
      const offset = inside ? 0 : premium > range.hi ? (premium - range.hi) / range.hi : (premium - range.lo) / range.lo;
      if (premium >= range.lo * (1 - tol) - EPS && premium <= range.hi * (1 + tol) + EPS) {
        const spread = range.lo === range.hi ? money(range.lo) : `${money(range.lo)}–${money(range.hi)}`;
        declaredUsed.push(
          `  ${state}  ${label}\n` +
          `        declared form of ${decl.cms_company}, filed ${spread}\n` +
          `        offset ${offset >= 0 ? '+' : ''}${(offset * 100).toFixed(2)}% of an allowance of ${decl.max_offset_pct}%` +
          (candidates.length
            ? `\n        ALSO inside the filed range of: ${candidates.join(', ')}`
            : ''),
        );
        continue;
      }
      unresolved++;
      console.log(`  OVER ALLOWED  ${label}`);
      console.log(
        `                declared as a form of ${decl.cms_company} (filed ${money(range.lo)}–${money(range.hi)}), ` +
        `but this is ${offset >= 0 ? '+' : ''}${(offset * 100).toFixed(2)}%`,
      );
      console.log(`                against a declared allowance of ${decl.max_offset_pct}%. Re-quote it, or raise the`);
      console.log('                allowance and say in `why` what changed.');
      continue;
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
      suggestions.push(`${state}\u0000  "${stated}": ["${candidates[0]}"]`);
      console.log(`                "${stated}" filed nothing under that name — alias, or wrong name`);
    }
  }
}

console.log('');
if (declaredUsed.length > 0) {
  console.log(`${declaredUsed.length} row(s) passed on a declared policy form, not on a filed figure:\n`);
  for (const d of declaredUsed) console.log(d);
  console.log('');
  console.log('Each of those is a premium no company filed under that name, allowed through');
  console.log(`because ${ALIAS_PATH} says why. Re-read them when the filings refresh.\n`);
}
if (suggestions.length > 0) {
  console.log(`If those are the same company, record it in ${ALIAS_PATH}:\n`);
  // Grouped by state because the alias map is keyed by state. `state` itself
  // is scoped to the per-state loop above and is long gone by here, which is
  // why each suggestion carries its own.
  const byState = new Map();
  for (const entry of new Set(suggestions)) {
    const [st, line] = entry.split('\u0000');
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push('  ' + line);
  }
  console.log('{\n  "aliases": {');
  console.log(
    [...byState]
      .map(([st, lines]) => `    "${st}": {\n${lines.join(',\n')}\n    }`)
      .join(',\n'),
  );
  console.log('  }\n}\n');
  console.log('Confirm each one against the filing. Matching numbers are not evidence');
  console.log('of a shared identity — that is the assumption this script exists to test.\n');
}

if (unresolved > 0) {
  console.log(`FAIL: ${unresolved} age-65 premium(s) could not be tied to the carrier shown.\n`);
  process.exit(1);
}
console.log("PASS: every age-65 projection premium was filed by the carrier it is shown under.\n");
