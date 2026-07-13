// Step 2 of 5 — interactive Plan G premium projection.
//
// Sits between About (zip/age/gender/tobacco) and Meds. The widget uses the
// same three inputs the user just supplied to seed its starting state, so
// the chart is already personalized when the page mounts. Continue branches
// on flow.isOep: OEP users skip Meds + Health straight to Results (same
// bypass About.tsx implements), everyone else continues to Meds.

import { Navigate, useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { stateForZip } from '../lib/medsupRates';
import { BackRow, Frame } from './Frame';
import { RateProjectionWidget } from './RateProjectionWidget';

export function RateProjection() {
  const navigate = useNavigate();
  const flow = useFlow();

  // Guard: this page seeds the widget from flow state set in About. If the
  // user lands here without going through About (bookmark, refresh, external
  // link, stale URL), redirect to About so they enter the funnel from step 1.
  if (flow.zip.length !== 5 || !flow.gender) {
    return <Navigate to="/embed/about" replace />;
  }

  const state = stateForZip(flow.zip);
  const initialGender: 'M' | 'F' = flow.gender === 'Female' ? 'F' : 'M';
  // Slider only spans 65–95; clamp so anyone outside the band still lands on
  // a valid index (the widget rounds to the nearest 5-year band internally).
  const initialAge = Math.min(Math.max(flow.age || 65, 65), 95);

  const onContinue = () => {
    if (flow.isOep) {
      navigate('/embed/results');
    } else {
      navigate('/embed/meds');
    }
  };

  return (
    <Frame step={2}>
      <div className="rate-projection-page">
        <BackRow onClick={() => navigate('/embed/about')} />
        <div className="step-label">Step 2 of 5 · Your rate projection</div>
        <h1 className="headline">
          Here's what Plan G <em>costs you</em> over time.
        </h1>
        <div className="sub-text">
          Toggle gender, slide your age, and click carriers in the legend to compare. The lowest
          20-year total is not always the lowest-premium carrier today.
        </div>

        <RateProjectionWidget
          state={state}
          zip={flow.zip}
          initialGender={initialGender}
          initialAge={initialAge}
        />

        <button className="btn" onClick={onContinue} type="button">
          {flow.isOep ? 'See your guaranteed plans →' : 'Continue to medications →'}
        </button>

        {/* NAIC Medicare Supplement Insurance Minimum Standards Model Act §13
            requires the rate-methodology disclosure (community-rated vs
            issue-age-rated vs attained-age-rated) on consumer materials that
            display Medigap premiums. Kept at the bottom of the rate
            projection screen so every consumer sees it alongside the rates. */}
        <div className="rate-methodology-disclosure" style={{
          marginTop: 16,
          padding: '12px 14px',
          background: 'rgba(13,47,94,0.04)',
          borderLeft: '3px solid rgba(13,47,94,0.35)',
          borderRadius: 6,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'rgba(13,47,94,0.85)',
        }}>
          <strong>How Medigap rates are set.</strong> Medicare Supplement premiums are
          filed with each state's Department of Insurance under one of three
          rate-setting methodologies: <em>attained-age-rated</em> (premium increases
          each year as you age), <em>issue-age-rated</em> (premium is fixed at the
          age you enrolled), or <em>community-rated</em> (same premium regardless
          of age; typical in North Carolina). Sample Plan G quotes for a 65-year-old
          non-tobacco applicant in your state typically fall in the $115–$180/month
          range from carriers such as Aetna, Cigna, Humana, Mutual of Omaha,
          UnitedHealthcare, Blue Cross NC, and Anthem — each files its own
          methodology, so the rate-projection curve above blends all three. Actual
          carrier-specific rate types are labeled next to each carrier on the
          Results screen.
        </div>

        <div className="disclaimer">
          <span className="privacy-badge">🔒 Rates are estimates</span>
          <br />
          Sourced from carrier filings. Actual premiums vary by exact birth date, health history,
          and carrier discounts.
        </div>
      </div>
    </Frame>
  );
}
