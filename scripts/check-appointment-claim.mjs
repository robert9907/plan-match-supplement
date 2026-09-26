#!/usr/bin/env node
// Fails the build when a consumer-facing file claims the carrier list was
// filtered to Generation Health's appointments.
//
//   node scripts/check-appointment-claim.mjs
//
// WHY. Rob ruled on 2026-09-19: show every carrier CMS lists, route
// non-appointed interest to him directly, and make the copy describe what is
// actually on screen. RateSourceDisclosure.tsx was corrected then and carries
// the history.
//
// MedSupRateDisclosure.tsx was not, and until 2026-09-25 it still ended
// "...except those this agency is not appointed with." Both components render
// on /rates — RateProjection renders RateSourceDisclosure, and the widget
// below it renders MedSupRateDisclosure — so the page told a consumer both
// that non-appointed carriers were filtered out and that they were listed.
//
// The fixture rule UNQUALIFIED_APPOINTMENT_CLAIM existed the whole time and
// missed it: singular "carrier", the subject "this agency", and the negative
// form. A rule that only fires on the one phrasing someone already fixed is
// not a guard. This scans the sources rather than a list of strings, so a NEW
// file making the claim is caught too — which is how it got in.
//
// Nothing in the rate path filters on appointment: api/medsup-rates.ts queries
// pm_medsup_rate_public on plan_letter, tobacco and carrier_state only.
// Carriers ARE withheld, via pm_medsup_carrier_exclusions (migration 005),
// but every row there is not_appointing_brokers or closed_block — carriers
// nobody can be appointed with, which is a different claim.
//
// If the product ever DOES filter to appointments: change the data first and
// this check second, in that order.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Keep in step with UNQUALIFIED_APPOINTMENT_CLAIM in qa/fixtures/medigap-rules.ts.
const CLAIM =
  /(rates?|carriers?|plans?)[^.]{0,80}(Generation Health|we|this agency|this site)\s+(is|are|am)\s+(not\s+)?appointed with/i;

// The sanctioned sentence describes the LIST instead of claiming it was
// filtered, so it must not trip the rule. See the phrasing note in
// RateSourceDisclosure.tsx.
const SANCTIONED =
  /Generation Health is not appointed with every carrier listed/i;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|jsx?|html)$/.test(name)) out.push(p);
  }
  return out;
}

// JSX wraps prose across lines, so the claim that slipped through was split
// over three of them ("...carrier" / "...this agency is not" / "appointed
// with."). Matching line by line misses it — the first version of this check
// did exactly that and passed while the claim was live. Collapse the file to
// one line before testing.
function collapse(text) {
  return text
    .replace(/^\s*(\/\/|\*|\/\*).*$/gm, ' ') // drop comment lines, banners included
    .replace(/\{'\s*'\}/g, ' ')                 // JSX {' '} spacers
    .replace(/[{}]/g, ' ')                        // {planLetter} → a word gap
    .replace(/\s+/g, ' ');
}

const hits = [];
for (const file of walk(join(ROOT, 'src'))) {
  const flat = collapse(readFileSync(file, 'utf8'));
  for (const m of flat.matchAll(new RegExp(CLAIM.source, 'gi'))) {
    if (SANCTIONED.test(m[0])) continue;
    hits.push(`${relative(ROOT, file)}: …${m[0].trim().slice(0, 130)}…`);
  }
}

if (hits.length > 0) {
  console.error(
    'FAIL  a consumer-facing file claims the carrier list is filtered to our appointments:\n' +
      hits.map((h) => '        ' + h).join('\n') +
      '\n\n      Nothing filters on appointment. Say what is on screen, as\n' +
      '      RateSourceDisclosure.tsx does, or change the data first.',
  );
  process.exit(1);
}
console.log('pass  no unqualified appointment claim in src/');
