// Compact popover explaining what "Plan G" or "Plan N" actually is.
// Reuses the compare-modal overlay + backdrop for tap-to-dismiss, but a
// narrower card + inline layout so it reads as a lightweight explainer
// rather than a full-page modal. Copy sourced from MedigapExplainer so
// the story matches the About-page education.

type Plan = 'G' | 'N';

interface PlanLetterPopoverProps {
  plan: Plan;
  onClose: () => void;
}

interface PlanCopy {
  letter: Plan;
  name: string;
  tagline: string;
  desc: string;
  copays: Array<{ label: string; value: string; free?: boolean }>;
  risk: { label: string; value: string };
}

const COPY: Record<Plan, PlanCopy> = {
  G: {
    letter: 'G',
    name: 'Plan G',
    tagline: 'Most popular',
    desc:
      'Covers everything except the small Part B deductible. After that, you pay $0 for Medicare-approved services.',
    copays: [
      { label: 'Doctor visits', value: '$0', free: true },
      { label: 'Specialist visits', value: '$0', free: true },
      { label: 'Emergency room', value: '$0', free: true },
    ],
    risk: { label: 'Annual out-of-pocket', value: '~$283 deductible' },
  },
  N: {
    letter: 'N',
    name: 'Plan N',
    tagline: 'Lower premium',
    desc:
      'Lower monthly cost in exchange for small office-visit and ER copays, plus possible excess charges from non-participating doctors.',
    copays: [
      { label: 'Doctor visits', value: 'up to $20' },
      { label: 'Specialist visits', value: 'up to $20' },
      { label: 'Emergency room', value: 'up to $50' },
    ],
    risk: { label: 'Annual out-of-pocket', value: '$283 + copays' },
  },
};

export function PlanLetterPopover({ plan, onClose }: PlanLetterPopoverProps) {
  const c = COPY[plan];
  return (
    <div
      className="compare-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`About ${c.name}`}
    >
      <div className="compare-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="compare-modal-card plan-letter-popover-card">
        <div className="compare-modal-head">
          <div className="plan-letter-popover-head-id">
            <span className={`plan-letter-popover-letter plan-${plan.toLowerCase()}`}>
              {c.letter}
            </span>
            <div>
              <div className="plan-letter-popover-name">{c.name}</div>
              <div className="plan-letter-popover-tagline">{c.tagline}</div>
            </div>
          </div>
          <button
            type="button"
            className="compare-modal-close"
            onClick={onClose}
            aria-label={`Close ${c.name} explainer`}
          >
            ×
          </button>
        </div>

        <p className="plan-letter-popover-desc">{c.desc}</p>

        <div className="plan-letter-popover-copays">
          {c.copays.map((row) => (
            <div className="plan-letter-popover-copay" key={row.label}>
              <span className="plan-letter-popover-copay-label">{row.label}</span>
              <span
                className={`plan-letter-popover-copay-value${row.free ? ' free' : ''}`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>

        <div className="plan-letter-popover-risk">
          <span className="plan-letter-popover-risk-label">{c.risk.label}</span>
          <span className="plan-letter-popover-risk-value">{c.risk.value}</span>
        </div>

        <p className="plan-letter-popover-foot">
          All carriers file the same standardized {c.name} benefits — you're only shopping
          on price and rate history.
        </p>
      </div>
    </div>
  );
}
