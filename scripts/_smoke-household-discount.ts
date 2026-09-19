// scripts/_smoke-household-discount.ts — smoke test
//
// The household-discount line on /results is a rate representation, so the
// property under test is the same one the projection chart has: a figure the
// screen cannot stand behind must render as words, never as a number.
//
// The defect this exists to prevent
// ---------------------------------
// pm_supp_carrier_rates.hhd_std_min / hhd_rm_min hold the monthly premium
// that applies under the carrier's household form. They are not the saving —
// across 3,384 rows carrying a value they average 95.5% of rate_min. The type
// that carried them into the app called them `hhdStandard` / `hhdRoommate`
// and documented them as "household discount", and discountCopy duly printed
// the premium as the saving. Atlantic Capital files $101.84 standard and
// $94.71 household in NC: a $7.13 discount rendered as "$95/mo".
//
// `oldDiscountCopy` below is that implementation, kept so the test
// demonstrates the overstatement rather than merely asserting its absence.
//
// Run: npx tsx scripts/_smoke-household-discount.ts

import { discountCopy, householdSaving } from '../src/lib/scoringEngine';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`);
  }
}

/** The original implementation. */
function oldDiscountCopy(r: { gHhd?: number; nHhd?: number }): string {
  if (r.gHhd && r.gHhd > 0) return `Household discount: $${r.gHhd.toFixed(0)}/mo for Plan G`;
  if (r.nHhd && r.nHhd > 0) return `Household discount: $${r.nHhd.toFixed(0)}/mo for Plan N`;
  return 'None listed';
}

console.log('\n1. The defect: the household premium printed as the saving');
check(
  'Atlantic Capital NC — old copy quotes the household premium',
  oldDiscountCopy({ gHhd: 94.71 }),
  'Household discount: $95/mo for Plan G',
);
check(
  'the real saving is the difference',
  Number(householdSaving(101.84, 94.71)!.toFixed(2)),
  7.13,
);

console.log('\n2. The saving is stated as a saving');
check(
  'Atlantic Capital NC',
  discountCopy({ gRate: 101.84, gHhdPremium: 94.71 }),
  'Household discount: $7/mo off Plan G',
);
check(
  'New Era NC — 144.00 standard, 135.36 household',
  discountCopy({ gRate: 144.0, gHhdPremium: 135.36 }),
  'Household discount: $9/mo off Plan G',
);
check(
  'AARP/UHC NC — 165.44 standard, 146.22 household',
  discountCopy({ gRate: 165.44, gHhdPremium: 146.22 }),
  'Household discount: $19/mo off Plan G',
);

console.log('\n3. A saving that cannot be quoted is not quoted');
check(
  'no household premium filed',
  discountCopy({ gRate: 144.0, nRate: 118.08 }),
  'None listed',
);
check(
  'HealthSpring — household premium above the standard rate (1.740x)',
  discountCopy({ gRate: 149.5, gHhdPremium: 260.13 }),
  'None listed',
);
check(
  'HealthSpring is suppressed, not absolute-valued into $111',
  discountCopy({ gRate: 149.5, gHhdPremium: 260.13 }).includes('111'),
  false,
);
check(
  'household premium equal to the rate is not a discount',
  discountCopy({ gRate: 144.0, gHhdPremium: 144.0 }),
  'None listed',
);

console.log('\n4. Plan N only — the case a >= 0 guard lets through');
// buildCarrierMap seeds gRate: 0 for a carrier that filed Plan N alone, so
// `gRate - gHhdPremium` is a large negative rather than a zero.
check(
  'the Plan G branch is skipped and Plan N answers',
  discountCopy({ gRate: 0, nRate: 121.4, nHhdPremium: 112.9 }),
  'Household discount: $9/mo off Plan N',
);
check(
  'a negative difference never reaches the screen',
  householdSaving(0, 112.9),
  null,
);
check(
  'Plan N with no rate either',
  discountCopy({ gRate: 0, nRate: 0, nHhdPremium: 112.9 }),
  'None listed',
);

console.log('\n5. Primitives');
check('undefined rate', householdSaving(undefined, 94.71), null);
check('undefined household premium', householdSaving(101.84, undefined), null);
check('zero household premium', householdSaving(101.84, 0), null);
check('negative household premium', householdSaving(101.84, -5), null);
check('a real pair', Number(householdSaving(165.44, 146.22)!.toFixed(2)), 19.22);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} assertion(s)\n`);
  process.exit(1);
}
console.log('\nPASS: the household line states a saving, or states nothing\n');
