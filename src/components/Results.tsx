import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { scoreApplication, type CarrierResult, type ScoringResult } from '../lib/scoringEngine';
import { lookupRates, prefetchRates } from '../lib/cmsPremiums';
import {
  groupCarriersByParent,
  cheapestVariantFor,
  bestHhdLabel,
  type CarrierGroup,
} from '../lib/carrierGroups';
import { ScoreRing } from './ScoreRing';
import { Building, type GroupContext } from './Building';
import { CompareModal } from './CompareModal';
import { FitScoreExplainer } from './FitScoreExplainer';
import { PlanLetterPopover } from './PlanLetterPopover';
import { BackRow, Frame } from './Frame';
import { MedigapDisclosures } from './MedigapDisclosures';
import { IconPill, IconHeart, IconScale, IconSmokingNo } from './Icons';

// Number of ranked picks the user can drop into the top-3 slot row.
const SLOT_COUNT = 3;

type FactorKey = 'meds' | 'health' | 'build' | 'tobacco';
const FACTOR_ITEMS: Array<{
  key: FactorKey;
  Icon: (props: { size?: number }) => JSX.Element;
  label: string;
}> = [
  { key: 'meds', Icon: IconPill, label: 'Meds' },
  { key: 'health', Icon: IconHeart, label: 'Health' },
  { key: 'build', Icon: IconScale, label: 'Build' },
  { key: 'tobacco', Icon: IconSmokingNo, label: 'Tobacco' },
];

// Pick the most-frequent value from a bag; ties broken by insertion
// order. Used to compute market-majority rate type / rate class so
// each Building card can flag when its own value differs.
function pickMajority(counts: Record<string, number>): string | null {
  let winner: string | null = null;
  let best = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > best) {
      best = v;
      winner = k;
    }
  }
  return winner;
}

// Explain why a factor is below 100%. Pulled from ScoringResult fields
// that the scoring engine already computes (comboFlags, healthFlagCount,
// buildClassLabel) plus the raw tobacco input. Returns null for OEP or
// 100% factors — those tiles have nothing to explain.
function reasonForFactor(
  key: FactorKey,
  scoring: ScoringResult,
  tobacco: 'Yes' | 'No' | null,
): string | null {
  switch (key) {
    case 'meds': {
      if (scoring.comboFlags.length > 0) return scoring.comboFlags.join(' ');
      if (scoring.flagCount > 0) {
        return `${scoring.flagCount} medication${scoring.flagCount === 1 ? '' : 's'} flagged on carrier underwriting lists.`;
      }
      return 'One or more medications require carrier-specific review.';
    }
    case 'health': {
      if (scoring.healthFlagCount === 0) return null;
      const n = scoring.healthFlagCount;
      return `You answered Yes to ${n} health question${n === 1 ? '' : 's'} on the screening — carriers factor these into acceptance and rate class.`;
    }
    case 'build': {
      return `Build class: ${scoring.buildClassLabel}. Outside the carriers' preferred (Standard) height-to-weight range, so most add a rate uplift.`;
    }
    case 'tobacco': {
      if (tobacco !== 'Yes') return null;
      return 'You reported current tobacco use. Most carriers file a separate tobacco rate class and add roughly a 20% premium; the exact uplift varies by carrier.';
    }
    default:
      return null;
  }
}

export function Results() {
  const navigate = useNavigate();
  const flow = useFlow();

  // Async-loaded scoring (rates prefetched in About → HealthScreen).
  const [scoring, setScoring] = useState<ScoringResult | null>(flow.scoring);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ranking + UI state.
  const [slots, setSlots] = useState<(CarrierGroup | null)[]>(
    () => Array(SLOT_COUNT).fill(null),
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [showFitExplainer, setShowFitExplainer] = useState(false);
  const [planPopover, setPlanPopover] = useState<'G' | 'N' | null>(null);
  const [autoSlotted, setAutoSlotted] = useState(false);

  const openFitExplainer = useCallback(() => setShowFitExplainer(true), []);
  const closeFitExplainer = useCallback(() => setShowFitExplainer(false), []);
  const openPlanG = useCallback(() => setPlanPopover('G'), []);
  const openPlanN = useCallback(() => setPlanPopover('N'), []);
  const closePlanPopover = useCallback(() => setPlanPopover(null), []);

  useEffect(() => {
    if (flow.scoring) {
      setScoring(flow.scoring);
      return;
    }
    if (!flow.gender || !flow.tobacco) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        await prefetchRates(flow.zip, flow.gender === 'Female' ? 'FEMALE' : 'MALE');
        if (cancelled) return;
        const result = scoreApplication({
          age: flow.age,
          gender: flow.gender!,
          tobacco: flow.tobacco!,
          zip: flow.zip,
          meds: flow.meds,
          health: flow.health,
          heightIn: flow.heightIn,
          weightLbs: flow.weightLbs,
          oep: flow.isOep,
        });
        flow.setScoring(result);
        setScoring(result);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Could not load rates');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.scoring]);

  // Build a quick name → rateType map from the prefetched CMS rates so the
  // CompareModal Rate-type row + Building meta line don't have to re-fetch.
  const rateTypeByCompany = useMemo(() => {
    if (!flow.gender || !flow.zip) return new Map<string, string>();
    const genderKey = flow.gender === 'Female' ? 'FEMALE' : 'MALE';
    const all = [
      ...lookupRates(flow.zip, 'G', genderKey),
      ...lookupRates(flow.zip, 'N', genderKey),
    ];
    const m = new Map<string, string>();
    for (const r of all) if (!m.has(r.company)) m.set(r.company, r.rateType);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring, flow.zip, flow.gender]);

  const groups = useMemo<CarrierGroup[]>(
    () =>
      scoring
        ? groupCarriersByParent(
            scoring.carriers,
            (name) => rateTypeByCompany.get(name) as never,
          )
        : [],
    [scoring, rateTypeByCompany],
  );
  const eligibleGroups = useMemo(() => groups.filter((g) => !g.allKnockedOut), [groups]);
  const knockoutGroups = useMemo(() => groups.filter((g) => g.allKnockedOut), [groups]);

  // Market stats used by Building's reasoning generator to produce
  // genuinely per-carrier bullets (price positioning, majority-vs-minority
  // rate methodology / rate class). Computed once here and passed down
  // rather than recomputed per card.
  const eligibleContext = useMemo<GroupContext>(() => {
    if (eligibleGroups.length === 0) {
      return {
        cheapestPrice: 0,
        eligibleCount: 0,
        majorityRateType: null,
        majorityRateClass: null,
      };
    }
    const prices: number[] = [];
    const rateTypeCounts: Record<string, number> = {};
    const rateClassCounts: Record<string, number> = {};
    for (const g of eligibleGroups) {
      const cG = cheapestVariantFor(g, 'G');
      const cN = cheapestVariantFor(g, 'N');
      const primary = cG ?? cN;
      if (primary) {
        const lo =
          cG && cN
            ? Math.min(cG.carrier.planGLo, cN.carrier.planNLo)
            : cG
              ? cG.carrier.planGLo
              : cN!.carrier.planNLo;
        if (lo > 0) prices.push(lo);
        const rc = primary.carrier.rateClass.name;
        rateClassCounts[rc] = (rateClassCounts[rc] ?? 0) + 1;
      }
      const rt = g.groupRateType ?? 'UNKNOWN';
      rateTypeCounts[rt] = (rateTypeCounts[rt] ?? 0) + 1;
    }
    const majorityRateTypeRaw = pickMajority(rateTypeCounts);
    const majorityRateType: GroupContext['majorityRateType'] =
      majorityRateTypeRaw === 'ATTAINED_AGE' ||
      majorityRateTypeRaw === 'ISSUE_AGE' ||
      majorityRateTypeRaw === 'COMMUNITY_RATED'
        ? majorityRateTypeRaw
        : null;
    const majorityRateClass = pickMajority(rateClassCounts);
    return {
      cheapestPrice: prices.length > 0 ? Math.min(...prices) : 0,
      eligibleCount: eligibleGroups.length,
      majorityRateType,
      majorityRateClass,
    };
  }, [eligibleGroups]);

  // Auto-populate the slots with the top three eligible groups on first
  // load. We track this with a flag so the user's subsequent removals
  // aren't overridden.
  useEffect(() => {
    if (autoSlotted) return;
    if (eligibleGroups.length === 0) return;
    setSlots(
      Array.from({ length: SLOT_COUNT }, (_, i) => eligibleGroups[i] ?? null),
    );
    setAutoSlotted(true);
  }, [eligibleGroups, autoSlotted]);

  const rankedParents = useMemo(() => {
    const s = new Set<string>();
    for (const slot of slots) if (slot) s.add(slot.parent);
    return s;
  }, [slots]);

  const slotsFilled = slots.filter(Boolean).length;

  // ── Drag-and-drop handlers ───────────────────────────────────────────
  const onBuildingDragStart = useCallback(
    (parent: string) => (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', parent);
      setDraggingId(parent);
    },
    [],
  );
  const onBuildingDragEnd = useCallback(() => {
    setDraggingId(null);
    setHoverSlot(null);
  }, []);
  const onSlotDragOver = useCallback(
    (i: number) => (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setHoverSlot(i);
    },
    [],
  );
  const onSlotDragLeave = useCallback(
    (i: number) => () => {
      setHoverSlot((cur) => (cur === i ? null : cur));
    },
    [],
  );
  const onSlotDrop = useCallback(
    (i: number) => (e: React.DragEvent) => {
      e.preventDefault();
      const parent = e.dataTransfer.getData('text/plain') || draggingId;
      if (!parent) return;
      const target = eligibleGroups.find((g) => g.parent === parent);
      if (!target) return;
      setSlots((prev) => {
        const next = [...prev];
        // Remove from any other slot first — no duplicates.
        for (let k = 0; k < next.length; k++) {
          if (next[k]?.parent === parent) next[k] = null;
        }
        next[i] = target;
        return next;
      });
      setDraggingId(null);
      setHoverSlot(null);
    },
    [draggingId, eligibleGroups],
  );

  // Click-to-add for touch UX — drag-and-drop is unreliable on iOS.
  const addToTop3 = useCallback(
    (group: CarrierGroup) => {
      setSlots((prev) => {
        if (prev.some((s) => s?.parent === group.parent)) return prev;
        const next = [...prev];
        const emptyIdx = next.findIndex((s) => s === null);
        if (emptyIdx === -1) {
          // All full — replace the lowest-score slot.
          let worstIdx = 0;
          let worstScore = Number.POSITIVE_INFINITY;
          for (let k = 0; k < next.length; k++) {
            const s = next[k];
            if (s && s.bestScore < worstScore) {
              worstScore = s.bestScore;
              worstIdx = k;
            }
          }
          next[worstIdx] = group;
        } else {
          next[emptyIdx] = group;
        }
        return next;
      });
    },
    [],
  );

  const clearSlot = useCallback((i: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = null;
      return next;
    });
  }, []);

  const removeFromTop3 = useCallback((group: CarrierGroup) => {
    setSlots((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s?.parent === group.parent) {
          changed = true;
          return null;
        }
        return s;
      });
      return changed ? next : prev;
    });
  }, []);

  const toggleExpand = useCallback((parent: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(parent)) next.delete(parent);
      else next.add(parent);
      return next;
    });
  }, []);

  const onApply = useCallback(
    (carrier: CarrierResult, plan: 'G' | 'N') => {
      flow.selectCarrier(carrier, plan);
      navigate('/apply');
    },
    [flow, navigate],
  );

  // ─── Loading / empty states ──────────────────────────────────────────
  if (!scoring) {
    const stale = !flow.gender || !flow.tobacco;
    return (
      <Frame step={5}>
        <BackRow onClick={() => navigate('/about')} />
        <div className="step-label">Step 6 of 6 · Your results</div>
        {stale ? (
          <>
            <h1 className="headline">Let's start from the beginning.</h1>
            <div className="sub-text">We need a few details first before we can show your qualification.</div>
            <button className="btn" onClick={() => navigate('/about')} type="button">
              Go to About you →
            </button>
          </>
        ) : loadError ? (
          <>
            <h1 className="headline">Couldn't load carrier rates.</h1>
            <div className="sub-text">{loadError}</div>
            <button className="btn" onClick={() => navigate('/about')} type="button">
              Start over →
            </button>
          </>
        ) : (
          <>
            <h1 className="headline">Loading your matches…</h1>
            <div className="sub-text">Pulling CMS rate data for your area.</div>
          </>
        )}
      </Frame>
    );
  }

  const backTarget = flow.isOep ? '/rates' : '/health';
  const profile = `${flow.age} · ${flow.gender ?? '—'} · ZIP ${flow.zip}`;
  const factorScores = {
    meds: scoring.factorMeds,
    health: scoring.factorHealth,
    build: scoring.factorBuild,
    tobacco: scoring.factorTobacco,
  };
  const totalPlans = eligibleGroups.reduce((sum, g) => sum + g.variants.length, 0);
  // Slots auto-populate with the top 3 eligible carriers, so the first
  // "Plan G / Plan N" mention in the main scroll is normally the first
  // filled slot with that plan letter. Building carries a fallback
  // "?" on the first carrier-list card too, in case the user cleared
  // every slot.
  const firstSlotWithPlanG = slots.findIndex(
    (s) => s !== null && cheapestVariantFor(s, 'G') !== null,
  );
  const firstSlotWithPlanN = slots.findIndex(
    (s) => s !== null && cheapestVariantFor(s, 'N') !== null,
  );
  const firstPlanGIdx = eligibleGroups.findIndex(
    (g) => cheapestVariantFor(g, 'G') !== null,
  );
  const firstPlanNIdx = eligibleGroups.findIndex(
    (g) => cheapestVariantFor(g, 'N') !== null,
  );

  return (
    <Frame step={5}>
      <BackRow onClick={() => navigate(backTarget)} />
      <div className="step-label">Step 6 of 6 · Your results</div>

      <header className="results-header">
        <div className="results-header-row">
          <div className="results-header-id">
            <div className="results-header-kicker">PLAN MATCH · SUPPLEMENT</div>
            <h1 className="results-header-title">Medicare Supplement</h1>
            <div className="results-header-sub">{profile}</div>
          </div>
          <div className="results-header-ring">
            <ScoreRing
              score={scoring.overall}
              size={64}
              onExplain={openFitExplainer}
            />
            <button
              type="button"
              className="fit-score-caption"
              onClick={openFitExplainer}
              aria-label="How is the Fit Score calculated?"
            >
              Fit Score <span aria-hidden="true">·</span> How?
            </button>
          </div>
        </div>
        <div className="results-header-verdict">{scoring.verdict}</div>
        <button
          type="button"
          className="factor-pills"
          onClick={openFitExplainer}
          aria-label="How is the Fit Score calculated?"
        >
          {FACTOR_ITEMS.map((f) => {
            // OEP profiles get the success tint (guaranteed acceptance is
            // effectively a 100% match). Otherwise ≥90% is success, below
            // is warning — see the "sensible default" note in the redesign
            // brief; flag for review if we want a subtler ladder later.
            const value = factorScores[f.key];
            const isSuccess = scoring.isOep || value >= 90;
            const tone = isSuccess ? 'success' : 'warn';
            const reducedReason =
              !scoring.isOep && value < 100
                ? reasonForFactor(f.key, scoring, flow.tobacco)
                : null;
            const tileTitle = scoring.isOep
              ? 'Open Enrollment Period — every carrier must accept you at their best rate class, no underwriting.'
              : reducedReason ?? undefined;
            return (
              <span
                className={`factor-pill tone-${tone}`}
                key={f.key}
                title={tileTitle}
              >
                <span className="factor-pill-icon" aria-hidden="true">
                  <f.Icon size={20} />
                </span>
                <span className="factor-pill-label">{f.label}</span>
                <span className="factor-pill-score">
                  {scoring.isOep ? '✓' : `${value}%`}
                  {reducedReason && (
                    <span className="factor-pill-info" aria-hidden="true">
                      {' '}ⓘ
                    </span>
                  )}
                </span>
              </span>
            );
          })}
        </button>
      </header>

      {scoring.comboFlags.length > 0 && (
        <div className="combo-alert">
          <b>⚠ Medication combination alert</b>
          <span>{scoring.comboFlags.join(' ')}</span>
        </div>
      )}

      {scoring.overall < 40 && !scoring.isOep && (
        <div className="cross-sell seafoam">
          <div className="cross-sell-title">Medicare Advantage might be a better fit</div>
          <div className="cross-sell-body">
            Medicare Advantage plans have <strong>no medical underwriting</strong> — you're accepted regardless of health
            conditions. They also cover prescriptions, dental, vision, and hearing in one plan with $0 premiums available.
          </div>
          <a
            className="cross-sell-cta"
            href="https://planmatch.generationhealth.me"
            target="_blank"
            rel="noreferrer"
          >
            Explore Medicare Advantage options →
          </a>
        </div>
      )}

      <div className="slot-section">
        <div className="slot-title">
          <span>Your top 3 picks to compare</span>
          <span className="slot-title-meta">Drag a carrier here or tap Compare</span>
        </div>
        <div className="slot-row">
          {slots.map((slot, i) => (
            <DropSlot
              key={i}
              index={i}
              group={slot}
              hover={hoverSlot === i}
              onDragOver={onSlotDragOver(i)}
              onDragLeave={onSlotDragLeave(i)}
              onDrop={onSlotDrop(i)}
              onClear={() => clearSlot(i)}
              onExplainScore={openFitExplainer}
              onExplainPlanG={i === firstSlotWithPlanG ? openPlanG : undefined}
              onExplainPlanN={i === firstSlotWithPlanN ? openPlanN : undefined}
            />
          ))}
        </div>
      </div>

      <div className="building-section-title">
        <span>
          {eligibleGroups.length} carrier {eligibleGroups.length === 1 ? 'family' : 'families'}
          {' · '}
          {totalPlans} plan{totalPlans === 1 ? '' : 's'}
        </span>
        <span className="building-section-meta">Drag · tap to expand</span>
      </div>

      <div className="building-list">
        {eligibleGroups.map((group, idx) => (
          <Building
            key={group.parent}
            group={group}
            expanded={expandedIds.has(group.parent)}
            ranked={rankedParents.has(group.parent)}
            dragging={draggingId === group.parent}
            isTopMatch={idx === 0}
            rankPosition={idx + 1}
            totalCarriers={eligibleGroups.length}
            overallScore={scoring.overall}
            context={eligibleContext}
            onToggleExpand={() => toggleExpand(group.parent)}
            onAddToTop3={() => addToTop3(group)}
            onRemoveFromTop3={() => removeFromTop3(group)}
            onApply={onApply}
            onExplainPlanG={
              firstSlotWithPlanG === -1 && idx === firstPlanGIdx
                ? openPlanG
                : undefined
            }
            onExplainPlanN={
              firstSlotWithPlanN === -1 && idx === firstPlanNIdx
                ? openPlanN
                : undefined
            }
            onDragStart={onBuildingDragStart(group.parent)}
            onDragEnd={onBuildingDragEnd}
          />
        ))}
      </div>

      {knockoutGroups.length > 0 && (
        <>
          <div className="building-section-title building-section-title-muted">
            <span>Not available for this profile</span>
            <span className="building-section-meta">
              {knockoutGroups.length} carrier{knockoutGroups.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="knockout-list">
            {knockoutGroups.map((g) => (
              <div key={g.parent} className="knockout-row">
                <span className="knockout-row-name">{g.parent}</span>
                <span className="knockout-row-reason">
                  {g.variants[0]?.carrier.knockoutReason ?? 'Not available'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="disclaimer">
        <strong>About these results:</strong> Qualification scores and estimated premiums are based on publicly available
        underwriting guidelines, CMS Plan Finder data, and predicted rate class. They are not guarantees. Final acceptance
        and rates are determined by each carrier's underwriting department. Exact quote provided before enrollment.
        <br />
        <br />
        Rates shown are from carriers Generation Health is appointed with and do not represent every Medicare Supplement
        insurer available in your area. Premiums are estimates sourced from Medicare.gov and are not a quote or a
        guarantee of coverage. Rob Simm, NPN #10447418.
        <br />
        <br />
        Contact Medicare.gov or 1-800-MEDICARE for a complete listing of insurers. This tool does not provide medical
        advice. Medicare Supplement plans do not cover prescription drugs. You'll need a separate standalone Part D
        prescription drug plan to cover your medications.
        <br />
        <br />
        <a
          className="cross-sell-cta"
          href="https://planmatch.generationhealth.me"
          target="_blank"
          rel="noopener noreferrer"
        >
          Compare Part D options →
        </a>
      </div>

      {/* Guaranteed Issue Rights enumeration + state-specific rating
          methodology explainer — required by CMS Medigap Guide §3 + 42
          CFR § 403.205 (GI) and NAIC Model Act §13 (rating methodology).
          Mounted on Results so the consumer sees them next to the rates
          they're being asked to compare. */}
      <MedigapDisclosures />

      <div className="results-footer-tel">
        <a href="tel:+18287613326">Questions? Call (828) 761-3326</a>
        <div className="results-footer-name">Rob Simm · NPN #10447418 · GenerationHealth.me</div>
      </div>

      <div className="action-bar-spacer" aria-hidden="true" />
      <div className="action-bar">
        <div className="action-bar-left">
          <span className="action-bar-count">{slotsFilled}</span>
          <span className="action-bar-status">
            {slotsFilled === SLOT_COUNT
              ? 'Ready to compare!'
              : slotsFilled === 0
              ? 'Add up to 3 carriers to compare'
              : `${SLOT_COUNT - slotsFilled} slot${SLOT_COUNT - slotsFilled === 1 ? '' : 's'} open`}
          </span>
        </div>
        <div className="action-bar-right">
          <button
            type="button"
            className="action-btn action-btn-ghost"
            onClick={() => window.print()}
            title="Save as PDF"
          >
            PDF
          </button>
          <button
            type="button"
            className="action-btn action-btn-ghost"
            onClick={() => {
              const sms = `sms:?&body=${encodeURIComponent(
                `My Plan Match supplement results: ${window.location.href}`,
              )}`;
              window.location.href = sms;
            }}
            title="Text these results"
          >
            Text
          </button>
          <button
            type="button"
            className="action-btn action-btn-primary"
            onClick={() => setShowCompare(true)}
            disabled={slotsFilled < 1}
          >
            Compare {slotsFilled > 1 ? slotsFilled : ''} →
          </button>
        </div>
      </div>

      {showCompare && (
        <CompareModal
          picks={slots.filter((s): s is CarrierGroup => s !== null)}
          onClose={() => setShowCompare(false)}
          onApply={onApply}
          onExplainPlanG={openPlanG}
          onExplainPlanN={openPlanN}
        />
      )}

      {showFitExplainer && (
        <FitScoreExplainer
          overall={scoring.overall}
          factors={factorScores}
          isOep={scoring.isOep}
          onClose={closeFitExplainer}
        />
      )}

      {planPopover && (
        <PlanLetterPopover plan={planPopover} onClose={closePlanPopover} />
      )}
    </Frame>
  );
}

// ─── DropSlot ────────────────────────────────────────────────────────────

interface DropSlotProps {
  index: number;
  group: CarrierGroup | null;
  hover: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClear: () => void;
  onExplainScore: () => void;
  /** When set, this slot's Plan G pill renders the "?" popover trigger.
   *  Results wires this only on the first slot that has a Plan G filing. */
  onExplainPlanG?: () => void;
  onExplainPlanN?: () => void;
}

function DropSlot({
  index,
  group,
  hover,
  onDragOver,
  onDragLeave,
  onDrop,
  onClear,
  onExplainScore,
  onExplainPlanG,
  onExplainPlanN,
}: DropSlotProps) {
  const filled = group !== null;
  const cls = `slot${filled ? ' slot-filled' : ''}${hover ? ' slot-hover' : ''}`;
  if (!filled) {
    return (
      <div className={cls} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className="slot-index" aria-hidden="true">{index + 1}</div>
        <div className="slot-empty-label">Add a carrier to compare</div>
      </div>
    );
  }
  const cG = cheapestVariantFor(group, 'G');
  const cN = cheapestVariantFor(group, 'N');
  const hhd = bestHhdLabel(group);
  return (
    <div className={cls} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button type="button" className="slot-clear" onClick={onClear} aria-label="Remove from compare">
        ×
      </button>
      <div className="slot-head">
        <ScoreRing score={group.bestScore} size={36} onExplain={onExplainScore} />
        <div className="slot-index-mini" aria-hidden="true">{index + 1}</div>
      </div>
      <div className="slot-name">{group.parent}</div>
      <div className="slot-prices">
        {cG && (
          <div className="slot-mini plan-g">
            <span className="slot-mini-letter">
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
            <span className="slot-mini-price">${cG.carrier.planGLo}/mo</span>
          </div>
        )}
        {cN && (
          <div className="slot-mini plan-n">
            <span className="slot-mini-letter">
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
            <span className="slot-mini-price">${cN.carrier.planNLo}/mo</span>
          </div>
        )}
      </div>
      {hhd && (
        <div
          className="slot-hhd"
          title="Household discount typically applies when two adults at the same address enroll — spouse, civil union, or (some carriers) any household member. Exact rules vary by carrier."
        >
          {hhd}
        </div>
      )}
    </div>
  );
}

