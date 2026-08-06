// Modal explainer for the "Fit Score" — one source of truth for what the
// 0–100 number on the header ring, the slot rings, and every carrier-card
// ring actually means. Reachable from every ScoreRing on the Results screen.

import { ScoreRing } from './ScoreRing';

interface FitScoreExplainerProps {
  overall: number;
  factors: {
    meds: number;
    health: number;
    build: number;
    tobacco: number;
  };
  isOep: boolean;
  onClose: () => void;
}

const FACTOR_ROWS: Array<{
  key: 'meds' | 'health' | 'build' | 'tobacco';
  icon: string;
  label: string;
  weight: string;
  desc: string;
}> = [
  {
    key: 'meds',
    icon: '💊',
    label: 'Meds match',
    weight: '40%',
    desc: "How well your current prescriptions line up with each carrier's underwriting rules.",
  },
  {
    key: 'health',
    icon: '❤️',
    label: 'Health',
    weight: '30%',
    desc: 'Whether your health-history answers avoid the carrier\'s knockout questions.',
  },
  {
    key: 'build',
    icon: '⚖️',
    label: 'Build',
    weight: '15%',
    desc: "Where your height and weight fall on the carrier's build chart.",
  },
  {
    key: 'tobacco',
    icon: '🚬',
    label: 'Tobacco',
    weight: '15%',
    desc: 'Tobacco use bumps the rate class and lowers the fit score.',
  },
];

export function FitScoreExplainer({ overall, factors, isOep, onClose }: FitScoreExplainerProps) {
  return (
    <div
      className="compare-modal"
      role="dialog"
      aria-modal="true"
      aria-label="How the Fit Score is calculated"
    >
      <div className="compare-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="compare-modal-card fit-explainer-card">
        <div className="compare-modal-head">
          <h2 className="compare-modal-title">How your Fit Score works</h2>
          <button
            type="button"
            className="compare-modal-close"
            onClick={onClose}
            aria-label="Close explainer"
          >
            ×
          </button>
        </div>

        <div className="fit-explainer-summary">
          <ScoreRing score={overall} size={72} />
          <div className="fit-explainer-summary-text">
            <div className="fit-explainer-summary-label">Your Fit Score</div>
            <p className="fit-explainer-summary-desc">
              {isOep
                ? "You're in your Open Enrollment window, so every carrier must accept you at their best rate class — no underwriting applies. Scores show 'N/A' below."
                : 'A 0–100 estimate of how likely a carrier is to accept your application at their best (lowest) rate class. Higher = better fit.'}
            </p>
          </div>
        </div>

        <div className="fit-explainer-rows">
          {FACTOR_ROWS.map((row) => {
            const value = factors[row.key];
            return (
              <div key={row.key} className="fit-explainer-row">
                <div className="fit-explainer-row-head">
                  <span className="fit-explainer-row-icon" aria-hidden="true">
                    {row.icon}
                  </span>
                  <span className="fit-explainer-row-label">{row.label}</span>
                  <span className="fit-explainer-row-weight">Weight {row.weight}</span>
                  <span className="fit-explainer-row-score">
                    {isOep ? 'N/A' : `${value}%`}
                  </span>
                </div>
                <p className="fit-explainer-row-desc">{row.desc}</p>
              </div>
            );
          })}
        </div>

        <p className="fit-explainer-foot">
          The Fit Score is our estimate based on public underwriting guidelines and CMS rate
          filings. It is <strong>not</strong> a guaranteed approval — final acceptance is
          decided by each carrier's underwriting department.
        </p>
      </div>
    </div>
  );
}
