import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { scoreApplication, type CarrierResult, type ScoringResult } from '../lib/scoringEngine';
import { BackRow, Frame } from './Frame';

function factorTone(value: number, tobacco = false): 'pass' | 'warn' | 'fail' {
  if (tobacco) return value >= 85 ? 'pass' : 'warn';
  if (value >= 70) return 'pass';
  if (value >= 40) return 'warn';
  return 'fail';
}

const RIBBONS = [
  { tier: 'gold', label: 'Best Match' },
  { tier: 'silver', label: 'Runner Up' },
  { tier: 'bronze', label: 'Also Strong' },
] as const;

export function Results() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [showUnlikely, setShowUnlikely] = useState(false);
  const [animated, setAnimated] = useState(false);

  // If the consumer landed on /embed/results without running the score
  // (e.g. Turning 65 OEP bypass, or direct nav), compute it now.
  const scoring: ScoringResult | null = useMemo(() => {
    if (flow.scoring) return flow.scoring;
    if (!flow.gender || !flow.tobacco) return null;
    const result = scoreApplication({
      age: flow.age,
      gender: flow.gender,
      tobacco: flow.tobacco,
      meds: flow.meds,
      health: flow.health,
      heightIn: flow.heightIn,
      weightLbs: flow.weightLbs,
      oep: flow.isOep,
    });
    return result;
  }, [flow]);

  useEffect(() => {
    if (scoring && !flow.scoring) flow.setScoring(scoring);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring]);

  useEffect(() => {
    // Kick off the width transitions after first paint.
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [scoring]);

  if (!scoring) {
    // Haven't been through About yet — route back.
    return (
      <Frame step={4}>
        <BackRow onClick={() => navigate('/embed/about')} />
        <div className="step-label">Step 4 of 4 · Your results</div>
        <h1 className="headline">Let's start from the beginning.</h1>
        <div className="sub-text">We need a few details first before we can show your qualification.</div>
        <button className="btn" onClick={() => navigate('/embed/about')} type="button">
          Go to About you →
        </button>
      </Frame>
    );
  }

  const likely = scoring.carriers.filter((c) => c.score >= 25);
  const unlikely = scoring.carriers.filter((c) => c.score < 25);

  const pickCarrier = (c: CarrierResult, plan: 'G' | 'N') => {
    flow.selectCarrier(c, plan);
    navigate('/embed/apply');
  };

  const backTarget = flow.isOep ? '/embed/about' : '/embed/health';

  return (
    <Frame step={4}>
      <BackRow onClick={() => navigate(backTarget)} />
      <div className="step-label">Step 4 of 4 · Your results</div>
      <h1 className="headline">
        Here's who will <em>cover</em> you.
      </h1>

      <div className="score-hero">
        <div className="score-hero-label">Your qualification score</div>
        <div className="score-bar-wrap">
          <div
            className={`score-bar ${scoring.overallTone}`}
            style={{ width: animated ? `${scoring.overall}%` : '0%' }}
          />
          <span className="score-pct">{scoring.overall}%</span>
        </div>
        <div className="score-verdict">{scoring.verdict}</div>
        <div className="score-factors-text">
          {scoring.isOep
            ? 'Open Enrollment — no screening required'
            : `4 factors · ${flow.meds.length} meds · ${scoring.healthFlagCount} health flags`}
        </div>
      </div>

      <div className="factors">
        <div className="factor">
          <div className="factor-icon">💊</div>
          <div className="factor-label">Meds</div>
          <div className={`factor-value ${factorTone(scoring.factorMeds)}`}>
            {scoring.isOep ? 'N/A' : `${scoring.factorMeds}%`}
          </div>
        </div>
        <div className="factor">
          <div className="factor-icon">❤️</div>
          <div className="factor-label">Health</div>
          <div className={`factor-value ${factorTone(scoring.factorHealth)}`}>
            {scoring.isOep ? 'N/A' : `${scoring.factorHealth}%`}
          </div>
        </div>
        <div className="factor">
          <div className="factor-icon">⚖️</div>
          <div className="factor-label">Build</div>
          <div className={`factor-value ${factorTone(scoring.factorBuild)}`}>
            {scoring.isOep ? 'N/A' : `${scoring.factorBuild}%`}
          </div>
        </div>
        <div className="factor">
          <div className="factor-icon">🚬</div>
          <div className="factor-label">Tobacco</div>
          <div className={`factor-value ${factorTone(scoring.factorTobacco, true)}`}>
            {scoring.factorTobacco}%
          </div>
        </div>
      </div>

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

      <div>
        {likely.map((c, i) => (
          <CarrierCard
            key={c.name}
            carrier={c}
            animated={animated}
            index={i}
            ribbon={i < RIBBONS.length ? RIBBONS[i] : null}
            onPick={(plan) => pickCarrier(c, plan)}
          />
        ))}
      </div>

      {unlikely.length > 0 && !showUnlikely && (
        <button className="red-toggle" onClick={() => setShowUnlikely(true)} type="button">
          Show unlikely carriers ▼
        </button>
      )}
      {unlikely.length > 0 && showUnlikely && (
        <div>
          {unlikely.map((c, i) => (
            <CarrierCard
              key={c.name}
              carrier={c}
              animated={animated}
              index={likely.length + i}
              ribbon={null}
              onPick={(plan) => pickCarrier(c, plan)}
            />
          ))}
        </div>
      )}

      <div className="disclaimer">
        <strong>About these results:</strong> Qualification scores and estimated premiums are based on publicly available
        underwriting guidelines, NC average rates, and predicted rate class. They are not guarantees. Final acceptance and
        rates are determined by each carrier's underwriting department. Exact quote provided before enrollment.
        <br />
        <br />
        We do not offer every plan available in your area. Contact Medicare.gov or 1-800-MEDICARE for a complete listing.
        This tool does not provide medical advice. Medicare Supplement plans do not cover prescription drugs.
      </div>

      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <a
          href="tel:+18287613326"
          style={{ fontSize: 13, color: 'var(--navy)', fontWeight: 600, textDecoration: 'none' }}
        >
          Questions? Call (828) 761-3326
        </a>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: 'var(--text-muted)',
            marginTop: 6,
          }}
        >
          Rob Simm · NPN #10447418 · GenerationHealth.me
        </div>
      </div>
    </Frame>
  );
}

interface CarrierCardProps {
  carrier: CarrierResult;
  animated: boolean;
  index: number;
  ribbon: (typeof RIBBONS)[number] | null;
  onPick: (plan: 'G' | 'N') => void;
}

function CarrierCard({ carrier, animated, index, ribbon, onPick }: CarrierCardProps) {
  const [plan, setPlan] = useState<'G' | 'N'>('G');

  if (carrier.hardKnockout) {
    return (
      <div className="cc cc-knockout">
        <div className="cc-top">
          <span className="cc-name">{carrier.name}</span>
          <span className="cc-knockout-tag">Not eligible</span>
        </div>
        <div className="cc-knockout-reason">{carrier.knockoutReason}</div>
        <div className="cc-disc">{carrier.discount} discount</div>
      </div>
    );
  }

  const hasRange = carrier.rateClass.lo > 0;
  // Stagger bar animations slightly so they cascade into view.
  const delay = animated ? `${index * 60}ms` : '0ms';
  return (
    <div className={`cc${ribbon ? ` cc-ribboned cc-ribbon-${ribbon.tier}` : ''}`}>
      {ribbon && <div className={`cc-ribbon ${ribbon.tier}`}>{ribbon.label}</div>}
      <div className="cc-top">
        <span className="cc-name">{carrier.name}</span>
        <span className={`cc-pct ${carrier.tone}`}>{carrier.score}%</span>
      </div>
      <div className="cc-bar-wrap">
        <div
          className={`cc-bar ${carrier.tone}`}
          style={{
            width: animated ? `${carrier.score}%` : '0%',
            transitionDelay: delay,
          }}
        />
      </div>

      {hasRange ? (
        <div className="rate-est">
          <div className="rate-est-label">Estimated premium range</div>
          <div className="rate-est-row">
            <span className="rate-est-plan">Plan G</span>
            <span className="rate-est-price">
              ${carrier.planGLo} – ${carrier.planGHi}/mo
            </span>
          </div>
          <div className="rate-est-row">
            <span className="rate-est-plan">Plan N</span>
            <span className="rate-est-price">
              ${carrier.planNLo} – ${carrier.planNHi}/mo
            </span>
          </div>
          <div className={`rate-class-badge ${carrier.rateClass.badge}`}>
            {carrier.rateClass.name} · Exact quote provided before enrollment
          </div>
        </div>
      ) : (
        <div className="rate-est" style={{ textAlign: 'center' }}>
          <div className="rate-est-label">Estimated premium</div>
          <div style={{ fontSize: 12, color: 'var(--red-text)', fontWeight: 600 }}>
            Unable to estimate — likely decline
          </div>
        </div>
      )}

      <div className="cc-reason">{carrier.reason}</div>

      {hasRange && (
        <>
          <div className="plan-toggle" role="radiogroup" aria-label={`Choose plan for ${carrier.name}`}>
            <button
              type="button"
              role="radio"
              aria-checked={plan === 'G'}
              className={`plan-toggle-opt${plan === 'G' ? ' selected' : ''}`}
              onClick={() => setPlan('G')}
            >
              <span className="plan-toggle-letter">Plan G</span>
              <span className="plan-toggle-price">
                ${carrier.planGLo}–${carrier.planGHi}/mo
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={plan === 'N'}
              className={`plan-toggle-opt${plan === 'N' ? ' selected' : ''}`}
              onClick={() => setPlan('N')}
            >
              <span className="plan-toggle-letter">Plan N</span>
              <span className="plan-toggle-price">
                ${carrier.planNLo}–${carrier.planNHi}/mo
              </span>
            </button>
          </div>
          <button className="cc-cta select" onClick={() => onPick(plan)} type="button">
            Select {carrier.name} Plan {plan} →
          </button>
        </>
      )}

      <div className="cc-disc">{carrier.discount} discount</div>
    </div>
  );
}
