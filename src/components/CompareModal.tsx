// Side-by-side modal for the up-to-three ranked picks. The Frame is only
// 420 px wide so we render a full-viewport overlay (escapes the Frame),
// then a vertical stack of rows per pick. The Frame's flex layout would
// crush a true horizontal grid below ~3 columns; stacked rows keep the
// numbers readable on mobile.

import { useMemo } from 'react';
import type { CarrierResult } from '../lib/scoringEngine';
import {
  bestHhdLabel,
  cheapestVariantFor,
  type CarrierGroup,
} from '../lib/carrierGroups';
import { ScoreRing } from './ScoreRing';

interface CompareModalProps {
  picks: CarrierGroup[];
  onClose: () => void;
  onApply: (carrier: CarrierResult, plan: 'G' | 'N') => void;
  /** Opens the shared Plan G / Plan N popover. Wired only on the first
   *  column so the "?" doesn't repeat down the stack. */
  onExplainPlanG?: () => void;
  onExplainPlanN?: () => void;
}

interface PickRow {
  group: CarrierGroup;
  gLo: number;
  gHi: number;
  nLo: number;
  nHi: number;
  rateType: string;
  rateTypeHint: string | null;
  hhd: string;
  applyCarrier: CarrierResult | null;
  applyPlan: 'G' | 'N';
}

export function CompareModal({
  picks,
  onClose,
  onApply,
  onExplainPlanG,
  onExplainPlanN,
}: CompareModalProps) {
  const rows = useMemo<PickRow[]>(
    () =>
      picks.map((g) => {
        const cG = cheapestVariantFor(g, 'G');
        const cN = cheapestVariantFor(g, 'N');
        // Default Apply CTA = the cheaper of the two filed plans.
        const applyCarrier = cG?.carrier ?? cN?.carrier ?? null;
        const applyPlan: 'G' | 'N' = cG ? 'G' : 'N';
        return {
          group: g,
          gLo: cG?.carrier.planGLo ?? 0,
          gHi: cG?.carrier.planGHi ?? 0,
          nLo: cN?.carrier.planNLo ?? 0,
          nHi: cN?.carrier.planNHi ?? 0,
          rateType: rateTypeLabel(g.groupRateType),
          rateTypeHint: rateTypeHint(g.groupRateType),
          hhd: bestHhdLabel(g) ?? '—',
          applyCarrier,
          applyPlan,
        };
      }),
    [picks],
  );

  const minG = rows.reduce(
    (m, r) => (r.gLo > 0 && r.gLo < m ? r.gLo : m),
    Number.POSITIVE_INFINITY,
  );
  const minN = rows.reduce(
    (m, r) => (r.nLo > 0 && r.nLo < m ? r.nLo : m),
    Number.POSITIVE_INFINITY,
  );

  return (
    <div className="compare-modal" role="dialog" aria-modal="true" aria-label="Side-by-side comparison">
      <div className="compare-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="compare-modal-card">
        <div className="compare-modal-head">
          <h2 className="compare-modal-title">Side-by-side comparison</h2>
          <button type="button" className="compare-modal-close" onClick={onClose} aria-label="Close comparison">
            ×
          </button>
        </div>

        <div className="compare-modal-list">
          {rows.map((r, i) => {
            const topPick = i === 0;
            const gIsBest = r.gLo > 0 && r.gLo === minG;
            const nIsBest = r.nLo > 0 && r.nLo === minN;
            return (
              <div key={r.group.parent} className={`compare-col${topPick ? ' compare-col-top' : ''}`}>
                <div className="compare-col-head">
                  <ScoreRing score={r.group.bestScore} size={52} />
                  <div className="compare-col-id">
                    <div className="compare-col-name">{r.group.parent}</div>
                    {topPick && <span className="compare-col-pick">★ HIGHEST FIT SCORE</span>}
                  </div>
                </div>
                <CompareRow
                  label="Plan G"
                  value={r.gLo > 0 ? `$${r.gLo}–$${r.gHi}/mo` : 'Not offered'}
                  best={gIsBest}
                  onExplain={topPick ? onExplainPlanG : undefined}
                  explainAria="What is Plan G?"
                />
                <CompareRow
                  label="Plan N"
                  value={r.nLo > 0 ? `$${r.nLo}–$${r.nHi}/mo` : 'Not offered'}
                  best={nIsBest}
                  onExplain={topPick ? onExplainPlanN : undefined}
                  explainAria="What is Plan N?"
                />
                <CompareRow
                  label="Rate type"
                  value={r.rateType}
                  hint={r.rateTypeHint ?? undefined}
                />
                <CompareRow
                  label="Plans filed"
                  value={`${r.group.variants.length} plan${r.group.variants.length === 1 ? '' : 's'}`}
                />
                <CompareRow
                  label="Household discount"
                  value={r.hhd}
                  hint="Applies when two adults at the same address enroll — spouse, civil union, or (some carriers) any household member. Exact rules vary by carrier."
                />

                {r.applyCarrier && (
                  <button
                    type="button"
                    className={`compare-col-cta${topPick ? ' compare-col-cta-primary' : ''}`}
                    onClick={() => r.applyCarrier && onApply(r.applyCarrier, r.applyPlan)}
                  >
                    Apply with Plan {r.applyPlan} →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CompareRow({
  label,
  value,
  best,
  hint,
  onExplain,
  explainAria,
}: {
  label: string;
  value: string;
  best?: boolean;
  hint?: string;
  onExplain?: () => void;
  explainAria?: string;
}) {
  return (
    <div className="compare-row">
      <span className="compare-row-label">
        {label}
        {hint && (
          <span className="compare-row-hint" title={hint} aria-label={hint}>
            {' '}ⓘ
          </span>
        )}
        {onExplain && (
          <button
            type="button"
            className="plan-letter-info"
            onClick={onExplain}
            aria-label={explainAria ?? 'More info'}
            title={explainAria ?? 'More info'}
          >
            ?
          </button>
        )}
      </span>
      <span className={`compare-row-value${best ? ' compare-row-best' : ''}`}>
        {best && <span aria-hidden="true">★ </span>}
        {value}
      </span>
    </div>
  );
}

function rateTypeLabel(rt?: string): string {
  if (rt === 'ATTAINED_AGE') return 'Attained-age priced';
  if (rt === 'ISSUE_AGE') return 'Issue-age priced';
  if (rt === 'COMMUNITY_RATED') return 'Community rated';
  return '—';
}

function rateTypeHint(rt?: string): string | null {
  if (rt === 'ATTAINED_AGE')
    return 'Your premium increases each year as you get older, plus general rate increases.';
  if (rt === 'ISSUE_AGE')
    return 'Your premium is set by your age when you first bought the plan — no age-based increases, only general rate increases.';
  if (rt === 'COMMUNITY_RATED')
    return 'Everyone in your area pays the same premium regardless of age. General rate increases still apply.';
  return null;
}
