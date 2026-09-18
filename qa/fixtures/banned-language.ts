// ---------------------------------------------------------------------------
// banned-language.ts — misleading / high-pressure marketing language.
//
// Ported from the MA consumer harness (~/Code/plan-match/qa/fixtures/
// cms-banned-words.ts) and retuned for Medigap under NAIC Model Act §22
// marketing standards.
//
// The one real change from the consumer list: `allowInContexts` is actually
// implemented here. The consumer version declares the field and never uses it,
// which is why "never" fires on a privacy statement like "Never transmitted to
// any carrier" — a false positive that teaches the operator to skim the report.
// A harness nobody reads enforces nothing.
// ---------------------------------------------------------------------------

export type BannedCategory = 'superlative' | 'urgency' | 'guarantee' | 'freebie' | 'pressure';

export interface BannedPattern {
  pattern: RegExp;
  category: BannedCategory;
  label: string;
  /**
   * Contexts in which the matched word is legitimate. Tested against the ~80
   * characters surrounding the match. A hit inside one of these is dropped.
   */
  allowInContexts?: RegExp[];
}

export const BANNED_PATTERNS: BannedPattern[] = [
  {
    pattern: /\bbest\b/gi,
    category: 'superlative',
    label: '"best" (unqualified superlative)',
    allowInContexts: [
      // "best rate class" is the carrier's own underwriting term of art.
      /best\s*\(?\s*(lowest)?\s*\)?\s*rate\s+class/i,
      // "to the best of my knowledge" is attestation language on the application.
      /to the best of (my|your) knowledge/i,
      /best\s+fit\b/i,
    ],
  },
  { pattern: /\bcheapest\b/gi, category: 'superlative', label: '"cheapest"' },
  { pattern: /\blowest[\s-]?cost\b/gi, category: 'superlative', label: '"lowest cost"' },
  { pattern: /\bhighest[\s-]?rated\b/gi, category: 'superlative', label: '"highest rated"' },
  { pattern: /\btop[\s-]?rated\b/gi, category: 'superlative', label: '"top rated"' },
  { pattern: /\bunbeatable\b/gi, category: 'superlative', label: '"unbeatable"' },

  {
    pattern: /\bguaranteed\b/gi,
    category: 'guarantee',
    label: '"guaranteed"',
    allowInContexts: [
      // 42 CFR §403.205 — the statutory term. Required, not marketing.
      /guaranteed\s+issue/i,
      /\bGI\s+rights?\b/i,
      // During the 6-month OEP window acceptance IS guaranteed by law, so
      // "guaranteed acceptance" on an OEP result is accurate, not a promise.
      /guaranteed\s+acceptance/i,
      // Negations are disclosures, not promises.
      /\b(not|never|no|isn'?t|aren'?t)\b[^.]{0,40}guaranteed/i,
      /guaranteed[^.]{0,30}\b(is not|are not)\b/i,
    ],
  },
  {
    pattern: /\balways\b/gi,
    category: 'guarantee',
    label: '"always" (absolute claim)',
    allowInContexts: [/is not always|not always\b/i],
  },
  {
    pattern: /\bnever\b/gi,
    category: 'guarantee',
    label: '"never" (absolute claim)',
    allowInContexts: [
      // Privacy statements, not coverage promises.
      /never\s+transmitted/i,
      /never\s+(sent|shared|sold|stored)/i,
    ],
  },

  { pattern: /\bact[\s-]?now\b/gi, category: 'urgency', label: '"act now"' },
  { pattern: /\blimited[\s-]?time\b/gi, category: 'urgency', label: '"limited time"' },
  { pattern: /\bdon['’]?t[\s-]?miss[\s-]?out\b/gi, category: 'urgency', label: '"don\'t miss out"' },
  { pattern: /\bhurry\b/gi, category: 'urgency', label: '"hurry"' },
  { pattern: /\blast[\s-]?chance\b/gi, category: 'urgency', label: '"last chance"' },
  { pattern: /\bexpires?\s+(today|tonight|soon)\b/gi, category: 'urgency', label: '"expires today/soon"' },
  {
    pattern: /\bcall[\s-]?now\b/gi,
    category: 'pressure',
    label: '"call now"',
    allowInContexts: [/call\s+now\s+to\s+(ask|learn)/i],
  },

  { pattern: /\bfree[\s-]?(plan|coverage|insurance|medigap)\b/gi, category: 'freebie', label: '"free plan/coverage"' },
  { pattern: /\brisk[\s-]?free\b/gi, category: 'freebie', label: '"risk-free"' },
  {
    pattern: /\bno[\s-]?obligation\b/gi,
    category: 'freebie',
    label: '"no obligation"',
  },
  {
    pattern: /\bno[\s-]?cost\b/gi,
    category: 'freebie',
    label: '"no cost"',
    allowInContexts: [/language assistance[^.]{0,60}no[\s-]?cost/i, /free of charge/i],
  },
];

export interface BannedHit {
  category: BannedCategory;
  label: string;
  match: string;
  index: number;
  context: string;
}

const CONTEXT_RADIUS = 40;

/**
 * Scan text for banned language. Deduplicates on (label, matched text) so a
 * word repeated forty times reports once. Hits whose surrounding context
 * matches an allowInContexts entry are dropped.
 */
export function scanForBannedLanguage(text: string): BannedHit[] {
  const hits: BannedHit[] = [];
  const seen = new Set<string>();

  for (const { pattern, category, label, allowInContexts } of BANNED_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const start = Math.max(0, m.index - CONTEXT_RADIUS);
      const end = Math.min(text.length, m.index + m[0].length + CONTEXT_RADIUS);
      const context = text.slice(start, end).replace(/\s+/g, ' ').trim();

      if (allowInContexts?.some((rx) => rx.test(context))) continue;

      const key = `${label}::${m[0].toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hits.push({ category, label, match: m[0], index: m.index, context });
    }
  }
  return hits;
}
