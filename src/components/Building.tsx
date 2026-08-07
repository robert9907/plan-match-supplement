// Carrier family card. Rank-1 gets a "Top match" pill badge + accent
// border; every card shows a short reasoning list (2-4 bullets sourced
// from CarrierGroup + CarrierResult fields that scoreApplication already
// exposes) so users see WHY a carrier lands where it does, not just a
// bare score. Three-button foot: View/Hide plans · Compare · Apply.
//
// Copy uses likelihood/estimate phrasing to match the compliance pass —
// no "will," "is," or diagnosis-implying language.

import { useMemo } from 'react';
import type { CarrierResult } from '../lib/scoringEngine';
import type { CarrierGroup, CarrierVariant } from '../lib/carrierGroups';
import { bestHhdLabel, cheapestVariantFor } from '../lib/carrierGroups';

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
  /** True for the top-ranked eligible carrier — turns on accent border
   *  and "Top match" pill badge. */
  isTopMatch: boolean;
  /** 1-indexed rank within the eligible list; used for the "Ranked N of X"
   *  meta line. */
  rankPosition: number;
  totalCarriers: number;
  /** Person-level overall score, used to detect meaningful per-carrier
   *  score delta (softens carrier-flexibility reason bullets). */
  overallScore: number;
  onToggleExpand: () => void;
  onAddToTop3: () => void;
  onRemoveFromTop3: () => void;
  onApply: (carrier: CarrierResult, plan: 'G' | 'N') => void;
  /** When set, the collapsed header renders a "?" info dot beside the
   *  displayed plan letter that opens the Plan G/N popover. Results
   *  only wires this on the first card that filed that plan letter. */
  onExplainPlanG?: () => void;
  onExplainPlanN?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

export function Building({
  group,
  expanded,
  ranked,
  dragging,
  isTopMatch,
  rankPosition,
  totalCarriers,
  overallScore,
  onToggleExpand,
  onAddToTop3,
  onRemoveFromTop3,
  onApply,
  onExplainPlanG,
  onExplainPlanN,
  onDragStart,
  onDragEnd,
}: BuildingProps) {
  const tierWord = group.variants.length === 1 ? 'plan' : 'plans';
  const rateTypeLabel = useMemo(() => rateTypeShortLabel(group.groupRateType), [group.groupRateType]);
  const rateTypeHint = useMemo(() => rateTypeHintText(group.groupRateType), [group.groupRateType]);

  const cheapestG = cheapestVariantFor(group, 'G');
  const cheapestN = cheapestVariantFor(group, 'N');

  // Header shows the cheaper of the two plans as the "from" price.
  // Same pick drives the default plan for the Apply CTA.
  const primaryVariant =
    cheapestG && cheapestN
      ? cheapestG.carrier.planGLo <= cheapestN.carrier.planNLo
        ? { variant: cheapestG, plan: 'G' as const }
        : { variant: cheapestN, plan: 'N' as const }
      : cheapestG
        ? { variant: cheapestG, plan: 'G' as const }
        : cheapestN
          ? { variant: cheapestN, plan: 'N' as const }
          : null;
  const headerPrice =
    primaryVariant?.plan === 'G'
      ? primaryVariant.variant.carrier.planGLo
      : primaryVariant?.plan === 'N'
        ? primaryVariant.variant.carrier.planNLo
        : 0;

  const reasons = useMemo(
    () => reasonsForGroup(group, overallScore),
    [group, overallScore],
  );

  return (
    <div
      className={`building${expanded ? ' building-open' : ''}${ranked ? ' building-ranked' : ''}${dragging ? ' building-dragging' : ''}${isTopMatch ? ' building-top-match' : ''}`}
      draggable={!ranked}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {isTopMatch && (
        <div className="top-match-badge" aria-label="Top match for your profile">
          Top match
        </div>
      )}

      <div className="building-header-2col">
        <div className="building-id">
          <div className="building-name">{group.parent}</div>
          <div className="building-meta">
            {primaryVariant && <>Plan {primaryVariant.plan}</>}
            {rateTypeLabel && (
              <>
                {primaryVariant ? ' · ' : ''}
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
        {primaryVariant && (
          <div className="building-price-col">
            <div className="building-price-num">${headerPrice}</div>
            <div className="building-price-unit">per month</div>
          </div>
        )}
      </div>

      {!expanded && (
        <>
          <div className="building-divider" aria-hidden="true" />
          <div className="building-rank">
            Ranked {rankPosition} of {totalCarriers} carriers based on your profile
          </div>
          {reasons.length > 0 && (
            <ul className="building-reasons">
              {reasons.map((r, i) => (
                <li className="building-reason" key={i}>
                  <span className="building-reason-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                  <span className="building-reason-text">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {expanded && (
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
      )}

      <div className="building-foot">
        <div className="building-actions building-actions-3col">
          <button
            type="button"
            className="building-toggle"
            onClick={onToggleExpand}
            aria-expanded={expanded}
          >
            <span className="building-toggle-text">
              {expanded ? 'Hide plans' : `View ${group.variants.length} ${tierWord}`}
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
          {primaryVariant && (
            <button
              type="button"
              className="building-apply"
              onClick={() => onApply(primaryVariant.variant.carrier, primaryVariant.plan)}
              aria-label={`Apply with ${group.parent} Plan ${primaryVariant.plan}`}
            >
              Apply →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Reasoning list generator ───────────────────────────────────────────
//
// Pulls factual + softened bullets from data scoreApplication already
// exposes on CarrierGroup / CarrierResult. Every bullet uses the
// likelihood phrasing established in the compliance pass — no stated
// fact, no diagnosis inference, no absolute cross-carrier claims.
// Returns 2-4 items; falls through gracefully when a group has fewer
// meaningful signals rather than padding with filler.
function reasonsForGroup(group: CarrierGroup, overallScore: number): string[] {
  const reasons: string[] = [];
  const cheapestG = cheapestVariantFor(group, 'G');
  const cheapestN = cheapestVariantFor(group, 'N');
  const primary = cheapestG ?? cheapestN;
  if (!primary) return reasons;
  const c = primary.carrier;

  // 1. Rate class assignment — softened.
  const rc = c.rateClass.name;
  if (rc === 'Preferred') {
    reasons.push('Modeled at Preferred rate class based on your profile');
  } else if (rc === 'Standard') {
    reasons.push('Modeled at Standard rate class based on your profile');
  } else if (rc === 'Standard I' || rc === 'Standard II' || rc === 'Standard III') {
    reasons.push(`Modeled at ${rc} (rated) based on your profile`);
  }

  // 2. Plan availability in the user's ZIP — factual.
  if (cheapestG && cheapestN) {
    reasons.push('Files both Plan G and Plan N in your ZIP');
  } else if (cheapestG) {
    reasons.push('Files Plan G in your ZIP (Plan N not filed)');
  } else if (cheapestN) {
    reasons.push('Files Plan N in your ZIP (Plan G not filed)');
  }

  // 3. Rate methodology — factual, sourced from CMS filings.
  if (group.groupRateType === 'COMMUNITY_RATED') {
    reasons.push('Community-rated — same premium regardless of age');
  } else if (group.groupRateType === 'ISSUE_AGE') {
    reasons.push('Issue-age priced — premium locked to your enrollment age');
  } else if (group.groupRateType === 'ATTAINED_AGE') {
    reasons.push('Attained-age priced — premium rises with age');
  }

  // 4. Household discount — factual, from CMS filings.
  const hhd = bestHhdLabel(group);
  if (hhd) reasons.push(hhd);

  // 5. Carrier-specific delta from person-level overall score — softened.
  //    Big positive delta means this carrier applied a floor bump (e.g.
  //    Bankers accepts insulin >50u where others decline); big negative
  //    means the carrier is stricter for this profile (e.g. Aetna
  //    diabetes+cardiac). Threshold 15 keeps it meaningful.
  const delta = c.score - overallScore;
  if (delta >= 15) {
    reasons.push('This carrier historically shows more flexibility for your profile — confirm directly with the carrier');
  } else if (delta <= -15) {
    reasons.push('This carrier applies stricter review for your profile — confirm directly with the carrier');
  }

  return reasons.slice(0, 4);
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
