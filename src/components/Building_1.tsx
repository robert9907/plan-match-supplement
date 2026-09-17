// Carrier family card. Rank-1 gets a "Top match" pill badge + accent
// border; every card shows a short reasoning list (2-4 bullets sourced
// from CarrierGroup + CarrierResult fields that scoreApplication already
// exposes) so users see WHY a carrier lands where it does, not just a
// bare score. Three-button foot: View/Hide plans · Compare · Apply.
//
// Copy uses likelihood/estimate phrasing to match the compliance pass —
// no "will," "is," or diagnosis-implying language.

import { useMemo, useState } from 'react';
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

/** Market context computed once in Results.tsx across all eligible
 *  carriers. Passed to every Building so reasonsForGroup can produce
 *  genuinely per-carrier bullets ("Lowest premium…" / "Within $8/mo of
 *  the lowest…" / "differs from most top carriers"). */
export interface GroupContext {
  /** Lowest low-end premium per plan letter across eligible carriers, so
   *  price bullets compare Plan G to Plan G and Plan N to Plan N. 0 when
   *  no eligible carrier filed that plan. */
  cheapestByPlan: { G: number; N: number };
  eligibleCount: number;
  majorityRateType: 'ATTAINED_AGE' | 'ISSUE_AGE' | 'COMMUNITY_RATED' | null;
  majorityRateClass: string | null;
}

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
  /** Market stats across all eligible groups — enables per-carrier
   *  reasoning that distinguishes this card from its neighbours. */
  context: GroupContext;
  onToggleExpand: () => void;
  onAddToTop3: () => void;
  onRemoveFromTop3: () => void;
  onApply: (carrier: CarrierResult, plan: 'G' | 'N') => void;
  /** Plan letter the card opens on. Results passes the plan the user
   *  last applied with for this family; otherwise the card defaults to
   *  the cheaper filed plan. Ignored if the family didn't file it. */
  defaultPlan?: 'G' | 'N';
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
  context,
  onToggleExpand,
  onAddToTop3,
  onRemoveFromTop3,
  onApply,
  defaultPlan,
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

  // The user picks Plan G or Plan N on the card; header price, reasoning
  // bullets and the Apply CTA all follow that pick. Opens on defaultPlan
  // when the family filed it, else the cheaper of the two filed plans.
  const cheaperPlan: 'G' | 'N' | null =
    cheapestG && cheapestN
      ? cheapestG.carrier.planGLo <= cheapestN.carrier.planNLo
        ? 'G'
        : 'N'
      : cheapestG
        ? 'G'
        : cheapestN
          ? 'N'
          : null;
  const [pickedPlan, setPickedPlan] = useState<'G' | 'N' | null>(() =>
    defaultPlan && (defaultPlan === 'G' ? cheapestG : cheapestN) ? defaultPlan : cheaperPlan,
  );
  const plan: 'G' | 'N' | null =
    pickedPlan && (pickedPlan === 'G' ? cheapestG : cheapestN) ? pickedPlan : cheaperPlan;
  const primaryVariant =
    plan === 'G' && cheapestG
      ? { variant: cheapestG, plan: 'G' as const }
      : plan === 'N' && cheapestN
        ? { variant: cheapestN, plan: 'N' as const }
        : null;
  const headerLo =
    primaryVariant?.plan === 'G'
      ? primaryVariant.variant.carrier.planGLo
      : primaryVariant?.plan === 'N'
        ? primaryVariant.variant.carrier.planNLo
        : 0;
  const headerHi =
    primaryVariant?.plan === 'G'
      ? primaryVariant.variant.carrier.planGHi
      : primaryVariant?.plan === 'N'
        ? primaryVariant.variant.carrier.planNHi
        : 0;
  const priceDisplay =
    headerLo === headerHi ? `$${headerLo}` : `$${headerLo}–$${headerHi}`;

  const reasons = useMemo(
    () => (primaryVariant ? reasonsForGroup(group, overallScore, context, primaryVariant, headerLo) : []),
    // primaryVariant is derived from group + plan
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, overallScore, context, plan, headerLo],
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
            {rateTypeLabel && (
              <>
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
            <div className="building-price-num">{priceDisplay}</div>
            <div className="building-price-unit">per month</div>
          </div>
        )}
      </div>

      {(cheapestG || cheapestN) && (
        <div className="plan-seg" role="radiogroup" aria-label={`Choose a plan from ${group.parent}`}>
          {(['G', 'N'] as const).map((letter) => {
            const v = letter === 'G' ? cheapestG : cheapestN;
            const lo = v ? (letter === 'G' ? v.carrier.planGLo : v.carrier.planNLo) : 0;
            const active = plan === letter;
            return (
              <button
                key={letter}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!v}
                className={`plan-seg-opt${active ? ' plan-seg-opt-active' : ''}`}
                onClick={() => setPickedPlan(letter)}
                title={v ? undefined : `${group.parent} doesn't offer Plan ${letter} in your area`}
              >
                <span className="plan-seg-letter">Plan {letter}</span>
                <span className="plan-seg-price">{v ? `from $${lo}` : 'Not offered'}</span>
              </button>
            );
          })}
        </div>
      )}

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
// Produces 2-4 bullets from data scoreApplication already exposes plus a
// per-page GroupContext (cheapest price, majority rate type/class). Bullets
// are actively differentiating — price positioning always fires with a
// per-carrier delta; HHD amount always varies per carrier when filed; rate
// methodology and rate class are annotated when they differ from the
// majority; the score-delta signal fires at a lower threshold (≥8pts) so
// per-carrier bumps like Bankers-flexibility or Aetna-strictness surface.
//
// When a carrier's profile is genuinely indistinct from the pack, we say
// so explicitly rather than repeating the majority rate class as if it
// were a differentiator.
//
// Copy uses the softened likelihood phrasing from the compliance pass.
function reasonsForGroup(
  group: CarrierGroup,
  overallScore: number,
  ctx: GroupContext,
  primary: { variant: CarrierVariant; plan: 'G' | 'N' },
  primaryPrice: number,
): string[] {
  const bullets: string[] = [];
  const c = primary.variant.carrier;
  const plan = primary.plan;
  const cheapestPrice = ctx.cheapestByPlan[plan];

  // Track whether we produced anything that meaningfully differentiates
  // this carrier from its neighbours. If we didn't, we'll lead with an
  // honest "comparable qualification profile" line instead of dressing
  // up shared attributes as differentiators.
  let hasDifferentiator = false;

  // 1. Price positioning — always distinct per carrier (uses ctx). Skip
  //    the "vs the rest" framing when there's only one eligible carrier.
  if (ctx.eligibleCount > 1 && cheapestPrice > 0 && primaryPrice > 0) {
    if (primaryPrice === cheapestPrice) {
      bullets.push(`Lowest Plan ${plan} premium among your top carrier matches`);
      hasDifferentiator = true;
    } else {
      const delta = primaryPrice - cheapestPrice;
      if (delta <= 10) {
        bullets.push(`Within $${delta}/mo of the lowest Plan ${plan} premium in your area`);
      } else {
        bullets.push(`$${delta}/mo above the lowest Plan ${plan} premium in your area`);
      }
      hasDifferentiator = true;
    }
  }

  // 2. Household discount — per-carrier value ($X/mo), so always a
  //    genuine differentiator when present.
  const hhd = bestHhdLabel(group);
  if (hhd) {
    bullets.push(hhd);
    hasDifferentiator = true;
  }

  // 3. Rate methodology — mention always (useful context); flag it as
  //    differing when this carrier is in the minority for the market.
  const isMajorityRateType =
    !ctx.majorityRateType || group.groupRateType === ctx.majorityRateType;
  if (group.groupRateType === 'COMMUNITY_RATED') {
    bullets.push(
      isMajorityRateType
        ? "Community-rated — premium doesn't rise with your age"
        : "Community-rated — premium doesn't rise with your age (differs from most top carriers)",
    );
    if (!isMajorityRateType) hasDifferentiator = true;
  } else if (group.groupRateType === 'ISSUE_AGE') {
    bullets.push(
      isMajorityRateType
        ? 'Issue-age priced — premium locked to your enrollment age'
        : 'Issue-age priced — premium locked to your enrollment age (differs from most top carriers)',
    );
    if (!isMajorityRateType) hasDifferentiator = true;
  } else if (group.groupRateType === 'ATTAINED_AGE') {
    bullets.push(
      isMajorityRateType
        ? 'Attained-age priced — premium rises each year with age'
        : 'Attained-age priced — premium rises each year with age (differs from most top carriers)',
    );
    if (!isMajorityRateType) hasDifferentiator = true;
  }

  // 4. Rate class — only surface when it differs from the majority (a
  //    Preferred sitting in a pool of Preferreds tells you nothing).
  const rc = c.rateClass.name;
  if (ctx.majorityRateClass && rc !== ctx.majorityRateClass) {
    bullets.push(`Modeled at ${rc} rate class — differs from most other top carriers`);
    hasDifferentiator = true;
  }

  // 5. Per-carrier score delta from the person-level overall — captures
  //    adjustCarrierScore() bumps (Bankers flexibility on diabetes/
  //    insulin, Cigna filed rated tiers on COPD, Aetna strictness on
  //    diabetes+cardiac). Lower threshold than v1 so small but real
  //    bumps surface.
  const scoreDelta = c.score - overallScore;
  if (scoreDelta >= 8) {
    bullets.push('This carrier historically shows more flexibility for your profile — confirm directly with the carrier');
    hasDifferentiator = true;
  } else if (scoreDelta <= -8) {
    bullets.push('This carrier applies stricter review for your profile — confirm directly with the carrier');
    hasDifferentiator = true;
  }

  // If nothing meaningful distinguishes this carrier from the pack,
  // lead with the honest fallback rather than parroting the majority
  // rate class / rate type.
  if (!hasDifferentiator) {
    bullets.unshift(
      'Comparable qualification profile to other top carriers — main difference here is price and household discount.',
    );
  }

  return bullets.slice(0, 4);
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
