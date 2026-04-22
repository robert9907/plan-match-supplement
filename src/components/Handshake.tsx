import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { Frame } from './Frame';

export function Handshake() {
  const navigate = useNavigate();
  const flow = useFlow();

  if (!flow.selectedCarrier) {
    return (
      <Frame tag="APPLICATION" hideDots>
        <h1 className="headline">Nothing to confirm yet.</h1>
        <div className="sub-text">Start a screening to apply.</div>
        <button className="btn" onClick={() => navigate('/embed/about')} type="button">
          Start over →
        </button>
      </Frame>
    );
  }

  const carrierName = flow.selectedCarrier.name;
  const planLetter = flow.selectedPlan;
  const firstName = flow.application.firstName || 'there';

  return (
    <Frame tag="APPLICATION" hideDots>
      <div className="success-icon">
        <svg viewBox="0 0 24 24">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="headline" style={{ textAlign: 'center' }}>
        Application <em>submitted.</em>
      </h1>
      <div className="sub-text" style={{ textAlign: 'center' }}>
        Your agent is reviewing your application now. You're almost covered.
      </div>

      <div className="sms-preview">
        <div className="sms-from">Auto-ack SMS — sent now</div>
        <div className="sms-body">
          Hi {firstName} — got your Plan Match application for {carrierName} Plan {planLetter}. Reviewing now and will
          submit to underwriting within 10 minutes. We'll text you next steps shortly. — NPN #10447418
        </div>
      </div>

      <div
        style={{
          background: 'var(--white)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: 10,
          }}
        >
          What happens next
        </div>
        <div className="step-row">
          <div className="step-num">1</div>
          <div className="step-text">
            <strong>Your agent reviews</strong> your application — within 10 minutes
          </div>
        </div>
        <div className="step-row">
          <div className="step-num">2</div>
          <div className="step-text">
            Submitted to <strong>{carrierName}</strong> underwriting
          </div>
        </div>
        <div className="step-row">
          <div className="step-num">3</div>
          <div className="step-text">
            You receive a <span className="highlight">secure payment link</span> from {carrierName} to enter your first
            premium payment
          </div>
        </div>
        <div className="step-row">
          <div className="step-num">4</div>
          <div className="step-text">
            Enter your payment info on <strong>{carrierName}'s secure page</strong> — your financial data goes directly to
            the carrier, never through Plan Match
          </div>
        </div>
        <div className="step-row">
          <div className="step-num">5</div>
          <div className="step-text">
            {carrierName} <strong>confirms acceptance</strong> in 5–7 business days
          </div>
        </div>
      </div>

      <div className="info-callout">
        <span className="info-icon">💳</span>
        <span className="info-text">
          <strong>About payment:</strong> You will enter your payment information (debit, credit, or bank account)
          directly on {carrierName}'s secure payment page — not through Plan Match. Your financial data is never stored or
          transmitted by us.
        </span>
      </div>

      <a href="tel:+18287613326" className="call-rob-link">
        📞 Can't wait? Call (828) 761-3326
      </a>

      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: 'var(--text-muted)',
          }}
        >
          Rob Simm · Licensed Independent Agent · NPN #10447418
        </div>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: 'var(--text-muted)',
            marginTop: 3,
          }}
        >
          2731 Meridian Pkwy, Durham, NC 27713
        </div>
        <div
          style={{
            fontSize: 8,
            color: 'var(--text-muted)',
            marginTop: 6,
            lineHeight: 1.5,
          }}
        >
          Not connected with or endorsed by the U.S. Government or the federal Medicare program. This is a solicitation of
          insurance.
        </div>
      </div>
    </Frame>
  );
}
