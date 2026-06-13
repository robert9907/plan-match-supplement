// Group CMS carrier rows by parent family.
//
// CMS files 53 distinct carrier names against our three states, but many are
// just plan-class variants of the same parent (e.g. "Atlantic Capital Life
// Assurance Company (Preferred)" + "(Standard)" → both belong under
// "Atlantic Capital"). The Results screen renders one card per parent
// family with the variants as rows the user can add to a compare tray.
//
// Pure data shaping — no UI dependencies. scoreApplication() and CarrierRate
// are untouched; this is a presentation-only post-processor.

import type { CarrierResult } from './scoringEngine';
import type { RateType } from './cmsPremiums';

export interface CarrierVariant {
  /** The underlying scored carrier (preserved verbatim — Application.tsx
   *  uses CarrierResult.name to identify selection downstream). */
  carrier: CarrierResult;
  /** Display label for the variant inside a group, e.g. "Preferred",
   *  "Standard II", "of America (Level 2)". Falls back to the raw CMS
   *  name when no parent family is detected. */
  variantLabel: string;
  /** CMS rate filing type for this carrier — surfaced in CompareModal.
   *  Populated when groupCarriersByParent is called with a lookup fn. */
  rateType?: RateType;
}

export interface CarrierGroup {
  /** Display name for the family, e.g. "UnitedHealthcare / AARP". */
  parent: string;
  variants: CarrierVariant[];
  /** Highest variant score in the group — used to sort groups. */
  bestScore: number;
  /** Cheapest Plan G low end across variants — used to sort within group. */
  cheapestG: number;
  /** True when every variant is hard-knocked-out. */
  allKnockedOut: boolean;
  /** Most-common rate type across variants for the compare row. */
  groupRateType?: RateType;
}

// ─── Parent-family rules ────────────────────────────────────────────────
//
// Each rule = (regex against CMS carrier name) → (parent label, variant
// extractor). Order matters — first match wins. extractor receives the
// raw CMS name and returns the variant label to show inside the group.

interface FamilyRule {
  match: RegExp;
  parent: string;
  variant: (cms: string) => string;
}

// Pull the content of the LAST set of parentheses, e.g.
// "Mutual of Omaha (Omaha Insurance Company)" → "Omaha Insurance Company".
function lastParenContent(s: string): string | null {
  const m = s.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

// Strip a known prefix and clean up the remainder for variant labels.
function stripPrefix(name: string, prefix: RegExp): string {
  return name.replace(prefix, '').trim();
}

const FAMILY_RULES: FamilyRule[] = [
  {
    match: /^AARP - UnitedHealthcare/i,
    parent: 'UnitedHealthcare / AARP',
    variant: (cms) => {
      // "AARP - UnitedHealthcare Insurance Company (Standard)" → "Standard"
      // "AARP - UnitedHealthcare Insurance Company of America (Level 2)" → "of America · Level 2"
      const cls = lastParenContent(cms) ?? 'Standard';
      const body = stripPrefix(
        cms.replace(/\s*\([^()]+\)\s*$/, ''),
        /^AARP - UnitedHealthcare Insurance Company\s*/i,
      );
      return body ? `${body} · ${cls}` : cls;
    },
  },
  {
    match: /^Atlantic Capital Life Assurance/i,
    parent: 'Atlantic Capital',
    variant: (cms) => lastParenContent(cms) ?? 'Standard',
  },
  {
    match: /^Bankers Fidelity Assurance/i,
    parent: 'Bankers Fidelity',
    variant: (cms) => lastParenContent(cms) ?? 'Standard',
  },
  {
    match: /^Bankers Life/i,
    parent: 'Bankers Life',
    variant: (cms) => {
      // The base plan has the "Washington National" subsidiary in parens but
      // no class designation; the rated tier appends "(Substandard)".
      return /Substandard/i.test(cms) ? 'Substandard' : 'Standard';
    },
  },
  {
    match: /^Medico /i,
    parent: 'Medico',
    variant: (cms) => {
      // "Medico Insurance Company (Preferred)" → "Insurance · Preferred"
      // "Medico Life and Health Insurance Company (Standard II)" → "Life & Health · Standard II"
      const cls = lastParenContent(cms) ?? 'Standard';
      const sub = stripPrefix(
        cms.replace(/\s*\([^()]+\)\s*$/, ''),
        /^Medico\s*/i,
      )
        .replace(/^Insurance Company$/i, 'Insurance')
        .replace(/^Life and Health Insurance Company$/i, 'Life & Health')
        .replace(/^Life and Health Insurance/, 'Life & Health');
      return sub ? `${sub} · ${cls}` : cls;
    },
  },
  {
    match: /^HealthSpring/i,
    parent: 'HealthSpring',
    variant: (cms) => lastParenContent(cms) ?? 'Standard',
  },
  {
    match: /^Mutual of Omaha/i,
    parent: 'Mutual of Omaha',
    variant: (cms) => lastParenContent(cms) ?? 'Standard',
  },
  {
    match: /^Humana/i,
    parent: 'Humana',
    variant: (cms) => {
      // "Humana Achieve (CompBenefits Insurance Company)" → "Achieve · CompBenefits"
      // "Humana (Emphesys Insurance Company)" → "Emphesys"
      const sub = lastParenContent(cms);
      const isAchieve = /^Humana Achieve/i.test(cms);
      if (sub) {
        const cleaned = sub.replace(/ Insurance Company$/i, '').replace(/, Inc\.$/i, '');
        return isAchieve ? `Achieve · ${cleaned}` : cleaned;
      }
      return isAchieve ? 'Achieve' : 'Standard';
    },
  },
  {
    match: /^Physicians Select Insurance/i,
    parent: 'Physicians Select',
    variant: (cms) => lastParenContent(cms) ?? 'Standard',
  },
  {
    match: /^New Era Life Insurance Company/i,
    parent: 'New Era Life',
    variant: (cms) =>
      /of the Midwest/i.test(cms) ? 'of the Midwest' : 'Standard',
  },
  {
    match: /^BlueCross BlueShield of /i,
    parent: 'BlueCross BlueShield',
    variant: (cms) => cms.replace(/^BlueCross BlueShield of\s*/i, ''),
  },
  {
    match: /^Anthem Blue Cross and Blue Shield/i,
    parent: 'Anthem BCBS',
    variant: (cms) => cms.replace(/^Anthem Blue Cross and Blue Shield\s*-\s*/i, ''),
  },
  {
    match: /^Aetna Health Insurance/i,
    parent: 'Aetna',
    variant: () => 'Aetna Health',
  },
  {
    match: /\(Aetna\)\s*$/i,
    parent: 'Aetna',
    variant: (cms) => {
      // "Continental Life Insurance Company of Brentwood, Tennessee (Aetna)"
      //   → "Continental Life (Brentwood)"
      return cms
        .replace(/\s*\(Aetna\)\s*$/i, '')
        .replace(/Insurance Company /i, '')
        .replace(/ of Brentwood, Tennessee$/i, ' (Brentwood)')
        .trim();
    },
  },
];

// Trim ceremonial suffixes when a carrier didn't match any family rule and
// is shown solo. Rules ordered most-specific → most-generic; the first
// trailing-suffix replace that matches wins. The CMS name
// "Globe Life and Accident Insurance Company" should read as
// "Globe Life", not as the full 6-word brand soup.
function cleanupSoloName(name: string): string {
  const SUFFIX_RULES: Array<[RegExp, string]> = [
    [/\s+Mutual Automobile Insurance Company$/i, ''],
    [/\s+Life and Accident Insurance Company$/i, ' Life'],
    [/\s+Life Insurance Company( of [A-Za-z ,]+)?$/i, ' Life'],
    [/\s+Insurance Company( of [A-Za-z ,]+)?$/i, ''],
    [/\s+Insurance Corporation$/i, ''],
    [/\s+Health Plan(s)?(, Inc\.)?$/i, ''],
  ];
  let out = name;
  for (const [pat, sub] of SUFFIX_RULES) {
    if (pat.test(out)) {
      out = out.replace(pat, sub);
      break;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function classifyCarrier(name: string): { parent: string; variantLabel: string } {
  for (const rule of FAMILY_RULES) {
    if (rule.match.test(name)) {
      return { parent: rule.parent, variantLabel: rule.variant(name) };
    }
  }
  const cleaned = cleanupSoloName(name);
  return { parent: cleaned, variantLabel: 'Standard plan' };
}

/** Sort key for a Plan G price; carriers with no G filed sort to the end. */
function planGSortKey(c: CarrierResult): number {
  if (c.hardKnockout || c.planGLo <= 0) return Number.POSITIVE_INFINITY;
  return c.planGLo;
}

/** Group a sorted CarrierResult[] into parent families.
 *
 *  Groups appear in descending bestScore order (knockouts last); variants
 *  inside each group are sorted by Plan G low-end price ascending so the
 *  cheapest qualifying tier appears first. The optional rateTypeFor lookup
 *  enriches each variant with its CMS rate-filing type — feed it from
 *  cmsPremiums.lookupRates() so the CompareModal can surface that field
 *  without re-fetching. */
export function groupCarriersByParent(
  carriers: CarrierResult[],
  rateTypeFor?: (carrierName: string) => RateType | undefined,
): CarrierGroup[] {
  const groups = new Map<string, CarrierGroup>();
  for (const carrier of carriers) {
    const { parent, variantLabel } = classifyCarrier(carrier.name);
    let group = groups.get(parent);
    if (!group) {
      group = {
        parent,
        variants: [],
        bestScore: 0,
        cheapestG: Number.POSITIVE_INFINITY,
        allKnockedOut: true,
      };
      groups.set(parent, group);
    }
    const rateType = rateTypeFor?.(carrier.name);
    group.variants.push({ carrier, variantLabel, rateType });
    if (carrier.score > group.bestScore) group.bestScore = carrier.score;
    if (!carrier.hardKnockout) group.allKnockedOut = false;
    const g = planGSortKey(carrier);
    if (g < group.cheapestG) group.cheapestG = g;
  }

  for (const group of groups.values()) {
    group.variants.sort((a, b) => planGSortKey(a.carrier) - planGSortKey(b.carrier));
    // Most-common rateType across variants — usually identical across a
    // family, but fall back to the first non-null when not.
    const counts = new Map<RateType, number>();
    for (const v of group.variants) {
      if (!v.rateType) continue;
      counts.set(v.rateType, (counts.get(v.rateType) ?? 0) + 1);
    }
    let bestN = 0;
    for (const [rt, n] of counts) {
      if (n > bestN) {
        bestN = n;
        group.groupRateType = rt;
      }
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    // Knocked-out families always sort to the bottom regardless of score.
    if (a.allKnockedOut !== b.allKnockedOut) return a.allKnockedOut ? 1 : -1;
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return a.cheapestG - b.cheapestG;
  });
}

/** The cheapest filing in a group for a given plan. Returns null when no
 *  variant in the group has that plan filed at a price > 0. */
export function cheapestVariantFor(
  group: CarrierGroup,
  plan: 'G' | 'N',
): CarrierVariant | null {
  let best: CarrierVariant | null = null;
  let bestLo = Number.POSITIVE_INFINITY;
  for (const v of group.variants) {
    const lo = plan === 'G' ? v.carrier.planGLo : v.carrier.planNLo;
    if (lo <= 0) continue;
    if (lo < bestLo) {
      bestLo = lo;
      best = v;
    }
  }
  return best;
}

/** Any HHD discount filed by any variant in the group — used in the
 *  collapsed building footer and the CompareModal HHD row. */
export function bestHhdLabel(group: CarrierGroup): string | null {
  for (const v of group.variants) {
    const d = v.carrier.discount;
    if (d && d !== 'None' && d !== 'None listed') return d;
  }
  return null;
}
