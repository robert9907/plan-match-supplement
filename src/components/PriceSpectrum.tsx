// Horizontal "where do my picks sit in the market?" chart. Every carrier
// family is a dot positioned by its cheapest Plan G price. The leftmost
// ~35% of the track gets a green tint — the "value zone" — so the buyer
// can see at a glance whether their top-3 picks are near the low end.
//
// Ranked picks get a larger dot with a teal fill and a soft glow so they
// pop out of the crowd. Other dots are coloured by score.

import { cheapestVariantFor, type CarrierGroup } from '../lib/carrierGroups';

interface PriceSpectrumProps {
  groups: CarrierGroup[];
  rankedParents: Set<string>;
  marketMin: number;
  marketMax: number;
}

export function PriceSpectrum({
  groups,
  rankedParents,
  marketMin,
  marketMax,
}: PriceSpectrumProps) {
  const span = Math.max(1, marketMax - marketMin);
  const midA = Math.round(marketMin + span * 0.33);
  const midB = Math.round(marketMin + span * 0.66);

  const dots = groups
    .map((g) => {
      const cheapest = cheapestVariantFor(g, 'G');
      if (!cheapest) return null;
      const price = cheapest.carrier.planGLo;
      const pct = Math.max(0, Math.min(100, ((price - marketMin) / span) * 100));
      const ranked = rankedParents.has(g.parent);
      const score = g.bestScore;
      return { parent: g.parent, price, pct, ranked, score };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (a.ranked === b.ranked ? 0 : a.ranked ? 1 : -1)); // ranked last so they paint on top

  return (
    <div className="spectrum">
      <div className="spectrum-head">
        <span className="spectrum-title">Plan G price spectrum</span>
        <span className="spectrum-range">
          ${marketMin} — ${marketMax}/mo
        </span>
      </div>
      <div className="spectrum-track">
        <div className="spectrum-value-zone" aria-hidden="true" />
        {dots.map((d) => {
          const cls = d.ranked
            ? 'spectrum-dot spectrum-dot-ranked'
            : `spectrum-dot ${d.score >= 90 ? 'spectrum-dot-good' : 'spectrum-dot-ok'}`;
          return (
            <div
              key={d.parent}
              className={cls}
              style={{ left: `calc(${d.pct}% - 7px)` }}
              title={`${d.parent} · $${d.price}/mo`}
            />
          );
        })}
      </div>
      <div className="spectrum-axis">
        <span>${marketMin}</span>
        <span>${midA}</span>
        <span>${midB}</span>
        <span>${marketMax}</span>
      </div>
    </div>
  );
}
