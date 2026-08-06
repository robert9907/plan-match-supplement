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
  onExplainPlan?: () => void;
}

function PriceBar({ plan, lo, hi, marketMin, marketMax, onExplainPlan }: PriceBarProps) {
  const span = Math.max(1, marketMax - marketMin);
  const pos = Math.max(0, Math.min(100, ((lo - marketMin) / span) * 100));
  const isG = plan === 'G';
  return (
    <div className="price-bar">
      <div className="price-bar-head">
        <span className={`price-bar-plan ${isG ? 'plan-g' : 'plan-n'}`}>
          Plan {plan}
          {onExplainPlan && (
            <button
              type="button"
              className="plan-letter-info"
              onClick={(e) => {
                e.stopPropagation();
                onExplainPlan();
              }}
              aria-label={`What is Plan ${plan}?`}
              title={`What is Plan ${plan}?`}
            >
              ?
            </button>
          )}
        </span>
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

function Floor({
  variant,
  onExplainPlanG,
  onExplainPlanN,
}: {
  variant: CarrierVariant;
  onExplainPlanG?: () => void;
  onExplainPlanN?: () => void;
}) {
  const c = variant.carrier;
  const hasG = c.planGLo > 0;
  const hasN = c.planNLo > 0;
  const rcHint = rateClassHint(c.rateClass.name);
  return (
    <div className="floor">
      <div className="floor-head">
        <span className="floor-label">{variant.variantLabel}</span>
        <span
          className={`badge-pill ${c.rateClass.badge}`}
          title={rcHint ?? undefined}
        >
          {c.rateClass.name}
          {rcHint && (
            <span className="badge-pill-info" aria-hidden="true">
              {' '}ⓘ
            </span>
          )}
        </span>
      </div>
      <div className="floor-tiles">
        <div className={`floor-tile ${hasG ? 'plan-g' : 'na'}`}>
          <span className="floor-tile-plan">
            Plan G
            {onExplainPlanG && (
              <button
                type="button"
                className="plan-letter-info"
                onClick={(e) => {
                  e.stopPropagation();
                  onExplainPlanG();
                }}
                aria-label="What is Plan G?"
                title="What is Plan G?"
              >
                ?
              </button>
            )}
          </span>
          {hasG ? (
            <span className="floor-tile-price">
              ${c.planGLo}–${c.planGHi}
              <span className="floor-tile-mo">/mo</span>
            </span>
          ) : (
            <span className="floor-tile-na">Not offered</span>
          )}
        </div>
        <div className={`floor-tile ${hasN ? 'plan-n' : 'na'}`}>
          <span className="floor-tile-plan">
            Plan N
            {onExplainPlanN && (
              <button
                type="button"
                className="plan-letter-info"
                onClick={(e) => {
                  e.stopPropagation();
                  onExplainPlanN();
                }}
                aria-label="What is Plan N?"
                title="What is Plan N?"
              >
                ?
              </button>
            )}
          </span>
          {hasN ? (
            <span className="floor-tile-price">
              ${c.planNLo}–${c.planNHi}
              <span className="floor-tile-mo">/mo</span>
            </span>
          ) : (
            <span className="floor-tile-na">Not offered</span>
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
  onRemoveFromTop3: () => void;
  onExplainScore: () => void;
  /** When set, the compact Plan G PriceBar renders a "?" info dot that
   *  opens the Plan G popover. Results only sets this on the first
   *  card that actually has a Plan G filing. */
  onExplainPlanG?: () => void;
  /** Same, for Plan N. */
  onExplainPlanN?: () => void;
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
  onRemoveFromTop3,
  onExplainScore,
  onExplainPlanG,
  onExplainPlanN,
  onDragStart,
  onDragEnd,
}: BuildingProps) {
  const score = group.bestScore;
  const tone = score >= 90 ? 'gold' : score >= 80 ? 'silver' : 'red';
  const tierWord = group.variants.length === 1 ? 'plan' : 'plans';
  const rateTypeLabel = useMemo(() => rateTypeShortLabel(group.groupRateType), [group.groupRateType]);
  const rateTypeHint = useMemo(() => rateTypeHintText(group.groupRateType), [group.groupRateType]);

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
            {rateTypeLabel && (
              <>
                {' · '}
                <span title={rateTypeHint ?? undefined}>
                  {rateTypeLabel}
                  {rateTypeHint && (
                    <span className="building-meta-info" aria-hidden="true">
                      {' '}ⓘ
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
        <ScoreRing score={score} size={44} onExplain={onExplainScore} />
      </div>

      {expanded ? (
        <div className="building-body">
          {group.variants.map((v, i) => (
            <Floor
              key={v.carrier.name}
              variant={v}
              onExplainPlanG={i === 0 ? onExplainPlanG : undefined}
              onExplainPlanN={i === 0 ? onExplainPlanN : undefined}
            />
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
              onExplainPlan={onExplainPlanG}
            />
          )}
          {cheapestN && (
            <PriceBar
              plan="N"
              lo={cheapestN.carrier.planNLo}
              hi={cheapestN.carrier.planNHi}
              marketMin={marketMin}
              marketMax={marketMax}
              onExplainPlan={onExplainPlanN}
            />
          )}
        </div>
      )}

      <div className="building-foot">
        <div className="building-hhd">
          {hhd ? (
            <span title="Household discount typically applies when two adults at the same address enroll — spouse, civil union, or (with some carriers) any household member. Exact rules vary by carrier.">
              {hhd}
              <span className="building-hhd-info" aria-hidden="true">
                {' '}ⓘ
              </span>
            </span>
          ) : (
            '·'
          )}
        </div>
        <div className="building-actions">
          {ranked ? (
            <button
              type="button"
              className="building-pick building-pick-active"
              onClick={onRemoveFromTop3}
              aria-label={`Remove ${group.parent} from compare`}
            >
              Comparing ✓
            </button>
          ) : (
            <button
              type="button"
              className="building-pick"
              onClick={onAddToTop3}
              aria-label={`Add ${group.parent} to compare`}
            >
              Compare
            </button>
          )}
          <button
            type="button"
            className="building-toggle"
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            <span className="building-toggle-text">
              {expanded
                ? 'Hide plans'
                : `View ${group.variants.length} ${tierWord}`}
            </span>
            <span
              className={`building-toggle-chev${expanded ? ' open' : ''}`}
              aria-hidden="true"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M2 3.5l3 3 3-3"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function rateTypeShortLabel(rt?: string): string | null {
  if (!rt) return null;
  if (rt === 'ATTAINED_AGE') return 'Attained-age priced';
  if (rt === 'ISSUE_AGE') return 'Issue-age priced';
  if (rt === 'COMMUNITY_RATED') return 'Community rated';
  return null;
}

// Copy sourced from rateClassForScore() in scoringEngine — each rate
// class maps to a premium multiplier range vs the age-65 non-tobacco
// base. Standard I/II/III share a "Rated (mild/moderate/high)" prefix
// so the worsening ladder reads clearly even when badges are seen out
// of context.
function rateClassHint(name: string): string | null {
  switch (name) {
    case 'Preferred':
      return 'Preferred — best rate class. Carrier sees you as a low-risk applicant; expect the lowest premium (about 85–95% of base rate).';
    case 'Standard':
      return 'Standard — baseline rate class. Most applicants land here; expect market-standard premiums (about 95–105% of base rate).';
    case 'Standard I':
      return 'Rated I (mild) — small premium bump for health, medication, or build reasons. About 5–15% higher than Standard.';
    case 'Standard II':
      return 'Rated II (moderate) — larger premium bump. About 15–25% higher than Standard.';
    case 'Standard III':
      return 'Rated III (high) — significant premium bump. About 25–40% higher than Standard.';
    case 'Likely Decline':
      return 'Likely Decline — this carrier probably will not offer coverage based on their underwriting rules. Consider Medicare Advantage or a Guaranteed Issue path.';
    default:
      return null;
  }
}

function rateTypeHintText(rt?: string): string | null {
  if (!rt) return null;
  if (rt === 'ATTAINED_AGE')
    return 'Your premium increases each year as you get older, plus general rate increases.';
  if (rt === 'ISSUE_AGE')
    return 'Your premium is set by your age when you first bought the plan — no age-based increases, only general rate increases.';
  if (rt === 'COMMUNITY_RATED')
    return 'Everyone in your area pays the same premium regardless of age. General rate increases still apply.';
  return null;
}
