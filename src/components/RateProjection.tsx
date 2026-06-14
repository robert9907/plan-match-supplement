// Step 2 of 5 — interactive Plan G premium projection.
//
// Sits between About (zip/age/gender/tobacco) and Meds. The widget uses the
// same three inputs the user just supplied to seed its starting state, so
// the chart is already personalized when the page mounts. Continue branches
// on flow.isOep: OEP users skip Meds + Health straight to Results (same
// bypass About.tsx implements), everyone else continues to Meds.

import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { stateForZip } from '../lib/medsupRates';
import { BackRow, Frame } from './Frame';
import { RateProjectionWidget } from './RateProjectionWidget';

export function RateProjection() {
  const navigate = useNavigate();
  const flow = useFlow();

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
      <BackRow onClick={() => navigate('/embed/about')} />
      <div className="step-label">Step 2 of 5 · Your rate projection</div>
      <h1 className="headline">
        Here's what Plan G <em>costs you</em> over time.
      </h1>
      <div className="sub-text">
        Toggle gender, slide your age, and click carriers in the legend to compare. The lowest
        20-year total often isn't the cheapest carrier today.
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

      <div className="disclaimer">
        <span className="privacy-badge">🔒 Rates are estimates</span>
        <br />
        Sourced from carrier filings. Actual premiums vary by exact birth date, health history, and
        carrier discounts.
      </div>
    </Frame>
  );
}
