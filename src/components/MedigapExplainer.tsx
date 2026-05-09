import { useState } from 'react';

export function MedigapExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className={`medigap-accordion${open ? ' open' : ''}`}>
      <button
        type="button"
        className="medigap-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="medigap-trigger-text">
          <span className="medigap-trigger-eyebrow">Understanding Medigap</span>
          <span className="medigap-trigger-title">Plan G vs Plan N</span>
        </span>
        <span className="medigap-trigger-chev" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M3 5l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="medigap-body">
          <p className="medigap-lede">
            Medigap (Medicare Supplement) plans are <strong>federally standardized</strong> — Plan G from one carrier
            covers the exact same things as Plan G from another carrier. Same letter, same benefits, no exceptions.
          </p>

          <div className="medigap-plans">
            <div className="medigap-plan">
              <div className="medigap-plan-head">
                <span className="medigap-plan-letter">G</span>
                <span className="medigap-plan-badge popular">Most popular</span>
              </div>
              <div className="medigap-plan-name">Plan G</div>
              <div className="medigap-plan-desc">
                Covers everything except the small Part B deductible. After that, you pay $0 for Medicare-approved
                services.
              </div>
              <div className="medigap-copays">
                <div className="copay-item"><span className="copay-label">Doctor visits</span><span className="copay-value free">$0</span></div>
                <div className="copay-item"><span className="copay-label">Specialist visits</span><span className="copay-value free">$0</span></div>
                <div className="copay-item"><span className="copay-label">Emergency room</span><span className="copay-value free">$0</span></div>
              </div>
              <div className="medigap-plan-risk">
                <span className="medigap-plan-risk-label">Annual out-of-pocket</span>
                <span className="medigap-plan-risk-value">~$257 deductible</span>
              </div>
            </div>

            <div className="medigap-plan">
              <div className="medigap-plan-head">
                <span className="medigap-plan-letter">N</span>
                <span className="medigap-plan-badge value">Lower premium</span>
              </div>
              <div className="medigap-plan-name">Plan N</div>
              <div className="medigap-plan-desc">
                Lower monthly cost in exchange for small office-visit and ER copays, plus possible excess charges from
                non-participating doctors.
              </div>
              <div className="medigap-copays">
                <div className="copay-item"><span className="copay-label">Doctor visits</span><span className="copay-value">up to $20</span></div>
                <div className="copay-item"><span className="copay-label">Specialist visits</span><span className="copay-value">up to $20</span></div>
                <div className="copay-item"><span className="copay-label">Emergency room</span><span className="copay-value">up to $50</span></div>
              </div>
              <div className="medigap-plan-risk">
                <span className="medigap-plan-risk-label">Annual out-of-pocket</span>
                <span className="medigap-plan-risk-value">$257 + copays</span>
              </div>
            </div>
          </div>

          <div className="medigap-callout">
            <span className="medigap-callout-icon">★</span>
            <span className="medigap-callout-text">
              Because the benefits are identical across carriers, <strong>you're only shopping price</strong>. Pick the
              plan letter, then pick the carrier with the lowest rate and best history of stable rate increases.
            </span>
          </div>

          <div className="medigap-contrast">
            <span className="medigap-contrast-label">Different from Medicare Advantage</span>
            <span className="medigap-contrast-text">
              MAPD plans <strong>are not standardized</strong> — copays, networks, drug coverage, and extra benefits
              vary by carrier and plan. With Medigap, the rules are the same everywhere.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
