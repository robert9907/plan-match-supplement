// ─── Build chart (height/weight → rate class) ────────────────────
//
// Approximates the Standard / Class I / Class II cutoffs used by major
// Medicare Supplement carriers. Real carrier tables vary slightly but
// these values are representative of the NC market and match the
// prototype's scoring model.
//
// Weight above CLASS_II_MAX = "Above max" — most carriers decline
// outright.

export type BuildClass = 'standard' | 'class1' | 'class2' | 'decline';

export type HeightInches = number;

type WeightByHeight = Record<HeightInches, number>;

// Standard weight ceilings — at or below this value = Preferred/Standard
// rate class (best rates).
export const STANDARD_MAX: WeightByHeight = {
  60: 174,
  61: 179,
  62: 185,
  63: 191,
  64: 197,
  65: 203,
  66: 209,
  67: 216,
  68: 222,
  69: 229,
  70: 236,
  71: 243,
  72: 250,
  73: 258,
  74: 265,
  75: 272,
  76: 280,
};

// Class I ceilings — above Standard, below this = +10% rate-up.
export const CLASS_I_MAX: WeightByHeight = {
  60: 197,
  61: 203,
  62: 210,
  63: 216,
  64: 223,
  65: 230,
  66: 237,
  67: 244,
  68: 252,
  69: 259,
  70: 267,
  71: 275,
  72: 283,
  73: 292,
  74: 300,
  75: 308,
  76: 317,
};

// Class II ceilings — above Class I, below this = +20% rate-up.
// Above Class II = most carriers decline.
export const CLASS_II_MAX: WeightByHeight = {
  60: 218,
  61: 225,
  62: 232,
  63: 240,
  64: 247,
  65: 255,
  66: 263,
  67: 271,
  68: 279,
  69: 287,
  70: 296,
  71: 304,
  72: 313,
  73: 323,
  74: 332,
  75: 341,
  76: 351,
};

export function classifyBuild(heightIn: number, weightLbs: number): BuildClass | null {
  if (!heightIn || !weightLbs) return null;
  const h = Math.round(heightIn);
  const std = STANDARD_MAX[h];
  const c1 = CLASS_I_MAX[h];
  const c2 = CLASS_II_MAX[h];
  if (!std || !c1 || !c2) return null;
  if (weightLbs <= std) return 'standard';
  if (weightLbs <= c1) return 'class1';
  if (weightLbs <= c2) return 'class2';
  return 'decline';
}

export function buildClassDescription(cls: BuildClass): { label: string; tone: 'pass' | 'warn' | 'fail' } {
  switch (cls) {
    case 'standard':
      return { label: '✓ Standard weight — best rates', tone: 'pass' };
    case 'class1':
      return { label: '⚠ Class I — +10%', tone: 'warn' };
    case 'class2':
      return { label: '⚠ Class II — +20%', tone: 'warn' };
    case 'decline':
      return { label: '✗ Above max — most decline', tone: 'fail' };
  }
}

export function heightLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const rem = inches % 12;
  return `${ft}'${rem}"`;
}

export const HEIGHT_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: 17 },
  (_, i) => {
    const inches = 60 + i;
    return { value: inches, label: heightLabel(inches) };
  },
);
