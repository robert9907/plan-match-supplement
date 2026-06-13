// One carrier family = one "building". When collapsed it shows a Plan G
// and Plan N PriceBar — the cheapest filing per plan plotted against the
// full market range. When expanded it stacks "floors" — one per variant —
// each showing the variant label, rate-class badge, and Plan G/N tiles.
//
// Buildings are draggable into the DropSlot row at the top. Click-to-add
// works too, since drag-and-drop on touch screens is unreliable.

import { useMemo } from 'react';
import type { CarrierGroup, CarrierVariant } from '../lib/carrierGroups';
import { bestHhdLabel, cheapestVariantFor } from '../lib/carrierGroups';
import { ScoreRing } from './ScoreRing';

// ─── PriceBar ───────────────────────────────────────────────────────────

interface PriceBarProps {
  plan: 'G' | 'N';
  lo: number;
  hi: number;
  marketMin: number;
  marketMax: number;
}

function PriceBar({ plan, lo, hi, marketMin, marketMax }: PriceBarProps) {
  const span = Math.max(1, marketMax - marketMin);
  const pos = Math.max(0, Math.min(100, ((lo - marketMin) / span) * 100));
  const isG = plan === 'G';
  return (
    <div className="price-bar">
      <div className="price-bar-head">
        <span className={`price-bar-plan ${isG ? 'plan-g' : 'plan-n'}`}>Plan {plan}</span>
        <span className="price-bar-price">
          ${lo}–${hi}
          <span className="price-bar-mo">/mo</span>
        </span>
      </div>
      <div className="price-bar-track">
        <div
          className={`price-bar-fill ${isG ? 'plan-g' : 'plan-n'}`}
          style={{ width: `${Math.max(2, pos)}%` }}
        />
        <div
          className="price-bar-marker"
          style={{ left: `calc(${pos}% - 4px)` }}
          aria-hidden="true"
        />
      </div>
      <div className="price-bar-range">
        <span>
          ${marketMin}
        </span>
        <span>${marketMax}</span>
      </div>
    </div>
  );
}

// ─── Floor (one variant inside an expanded building) ────────────────────

function Floor({ variant }: { variant: CarrierVariant }) {
  const c = variant.carrier;
  const hasG = c.planGLo > 0;
  const hasN = c.planNLo > 0;
  return (
    <div className="floor">
      <div className="floor-head">
        <span className="floor-label">{variant.variantLabel}</span>
        <span className={`badge-pill ${c.rateClass.badge}`}>{c.rateClass.name}</span>
      </div>
      <div className="floor-tiles">
        <div className={`floor-tile ${hasG ? 'plan-g' : 'na'}`}>
          <span className="floor-tile-plan">Plan G</span>
          {hasG ? (
            <span className="floor-tile-price">
              ${c.planGLo}–${c.planGHi}
              <span className="floor-tile-mo">/mo</span>
            </span>
          ) : (
            <span className="floor-tile-na">Not filed</span>
          )}
        </div>
        <div className={`floor-tile ${hasN ? 'plan-n' : 'na'}`}>
          <span className="floor-tile-plan">Plan N</span>
          {hasN ? (
            <span className="floor-tile-price">
              ${c.planNLo}–${c.planNHi}
              <span className="floor-tile-mo">/mo</span>
            </span>
          ) : (
            <span className="floor-tile-na">Not filed</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Building ───────────────────────────────────────────────────────────

interface BuildingProps {
  group: CarrierGroup;
  expanded: boolean;
  ranked: boolean;
  dragging: boolean;
  marketMin: number;
  marketMax: number;
  onToggleExpand: () => void;
  onAddToTop3: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export function Building({
  group,
  expanded,
  ranked,
  dragging,
  marketMin,
  marketMax,
  onToggleExpand,
  onAddToTop3,
  onDragStart,
  onDragEnd,
}: BuildingProps) {
  const score = group.bestScore;
  const tone = score >= 90 ? 'gold' : score >= 80 ? 'silver' : 'red';
  const tierWord = group.variants.length === 1 ? 'tier' : 'tiers';
  const rateTypeLabel = useMemo(() => rateTypeShortLabel(group.groupRateType), [group.groupRateType]);

  const cheapestG = cheapestVariantFor(group, 'G');
  const cheapestN = cheapestVariantFor(group, 'N');
  const hhd = bestHhdLabel(group);

  return (
    <div
      className={`building${expanded ? ' building-open' : ''}${ranked ? ' building-ranked' : ''}${dragging ? ' building-dragging' : ''}`}
      draggable={!ranked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={`building-stripe stripe-${tone}`} />
      <div className="building-head">
        <div className="building-id">
          <div className="building-name">{group.parent}</div>
          <div className="building-meta">
            {group.variants.length} {tierWord}
            {rateTypeLabel && <> · {rateTypeLabel}</>}
          </div>
        </div>
        <ScoreRing score={score} size={44} />
      </div>

      {expanded ? (
        <div className="building-body">
          {group.variants.map((v) => (
            <Floor key={v.carrier.name} variant={v} />
          ))}
        </div>
      ) : (
        <div className="building-body building-body-compact">
          {cheapestG && (
            <PriceBar
              plan="G"
              lo={cheapestG.carrier.planGLo}
              hi={cheapestG.carrier.planGHi}
              marketMin={marketMin}
              marketMax={marketMax}
            />
          )}
          {cheapestN && (
            <PriceBar
              plan="N"
              lo={cheapestN.carrier.planNLo}
              hi={cheapestN.carrier.planNHi}
              marketMin={marketMin}
              marketMax={marketMax}
            />
          )}
        </div>
      )}

      <div className="building-foot">
        <div className="building-hhd">{hhd ?? '·'}</div>
        <div className="building-actions">
          {!ranked && (
            <button
              type="button"
              className="building-pick"
              onClick={onAddToTop3}
              aria-label={`Add ${group.parent} to top 3`}
            >
              ★ Pick
            </button>
          )}
          <button
            type="button"
            className="building-toggle"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
          >
            {expanded ? '−' : '+'}
          </button>
        </div>
      </div>

      {ranked && (
        <div className="building-ranked-overlay" aria-hidden="true">
          <span className="building-ranked-badge">✓ RANKED</span>
        </div>
      )}
    </div>
  );
}

function rateTypeShortLabel(rt?: string): string | null {
  if (!rt) return null;
  if (rt === 'ATTAINED_AGE') return 'Attained age';
  if (rt === 'ISSUE_AGE') return 'Issue age';
  if (rt === 'COMMUNITY_RATED') return 'Community rated';
  return null;
}
