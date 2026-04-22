import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDob, useFlow } from '../context/FlowContext';
import { heightLabel } from '../lib/buildChart';
import { submitApplication } from '../lib/submitApplication';
import { BackRow, Frame } from './Frame';

type Stage = 'review' | 'details' | 'sign';

export function Application() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [stage, setStage] = useState<Stage>('review');

  if (!flow.selectedCarrier || !flow.scoring) {
    return (
      <Frame tag="APPLICATION" hideDots>
        <div className="step-label">Application</div>
        <h1 className="headline">
          Let's pick a <em>plan</em> first.
        </h1>
        <div className="sub-text">
          You haven't selected a carrier yet. Head back to your results and pick one to apply with.
        </div>
        <button className="btn" onClick={() => navigate('/embed/results')} type="button">
          Back to results →
        </button>
      </Frame>
    );
  }

  const carrier = flow.selectedCarrier;
  const planLetter = flow.selectedPlan;
  const rateLo = planLetter === 'G' ? carrier.planGLo : carrier.planNLo;
  const rateHi = planLetter === 'G' ? carrier.planGHi : carrier.planNHi;

  if (stage === 'review') {
    return (
      <ReviewStage
        onNext={() => setStage('details')}
        onBack={() => navigate('/embed/results')}
        planLetter={planLetter}
        rateRange={`$${rateLo}–$${rateHi}`}
        rateClassName={carrier.rateClass.name}
        carrierName={carrier.name}
      />
    );
  }
  if (stage === 'details') {
    return <DetailsStage onNext={() => setStage('sign')} onBack={() => setStage('review')} />;
  }
  return <SignStage onBack={() => setStage('details')} carrierName={carrier.name} />;
}

// ─── Stage 1: Review pre-filled data ─────────────────────────────

interface ReviewStageProps {
  onNext: () => void;
  onBack: () => void;
  planLetter: 'G' | 'N';
  rateRange: string;
  rateClassName: string;
  carrierName: string;
}

function ReviewStage({ onNext, onBack, planLetter, rateRange, rateClassName, carrierName }: ReviewStageProps) {
  const flow = useFlow();
  const dobDisplay = formatDob(flow.dob);
  const heightDisplay =
    flow.heightIn && flow.weightLbs ? `${heightLabel(flow.heightIn)} / ${flow.weightLbs} lbs` : '—';

  const hasKnockouts =
    [
      flow.health.q1_hospitalized,
      flow.health.q2_hospice,
      flow.health.q3_dialysis,
      flow.health.q4_cancer,
      flow.health.q5_transplant,
      flow.health.q6_als_hiv_hepc,
      flow.health.q10_neuro,
      flow.health.q11_mental,
      flow.health.q12_pending,
    ].filter((a) => a === 'y').length > 0;

  const diabetesLabel = (() => {
    if (flow.health.q7_diabetes !== 'y') return 'No';
    const mgmt = flow.health.diabetesMgmt;
    const map: Record<string, string> = {
      diet: 'diet-controlled',
      oral: 'oral meds',
      u50: '<50u insulin',
      o50: '50u+ insulin',
    };
    return `Yes — ${mgmt ? map[mgmt] : 'not specified'}`;
  })();

  const heartLabel = (() => {
    if (flow.health.q8_heart !== 'y') return 'No';
    const map: Record<string, string> = { o2: '2+ years ago', u2: 'within 2 years', now: 'current' };
    return flow.health.heartRecency ? `Yes — ${map[flow.health.heartRecency]}` : 'Yes';
  })();

  const otherFlags = (() => {
    const list: string[] = [];
    if (flow.health.q9_copd === 'y') list.push('COPD/respiratory');
    if (hasKnockouts) list.push('knockout condition flagged');
    return list.length ? list.join(', ') : 'None flagged';
  })();

  const scoring = flow.scoring!;
  const displayName =
    flow.application.firstName || flow.application.lastName
      ? `${flow.application.firstName} ${flow.application.lastName}`.trim()
      : '— enter on next step';

  return (
    <Frame tag="APPLICATION" hideDots>
      <BackRow onClick={onBack} />
      <div className="step-label">Application · Review your information</div>
      <h1 className="headline">
        Almost there — let's <em>review.</em>
      </h1>
      <div className="sub-text">
        We pre-filled your application from your screening. Confirm everything is correct.
      </div>

      <div className="plan-selected">
        <div className="plan-selected-dot" />
        <div className="plan-selected-info">
          <div className="plan-selected-name">Plan {planLetter} — {carrierName}</div>
          <div className="plan-selected-carrier">Medicare Supplement</div>
        </div>
        <div>
          <div className="plan-selected-rate">{rateRange}</div>
          <div className="plan-selected-range">per month · {rateClassName}</div>
        </div>
      </div>

      <div className="prefill-card">
        <div className="prefill-header">
          <span className="prefill-title">Personal information</span>
          <span className="prefill-badge">✓ Pre-filled</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Name</span>
          <span className="prefill-value">{displayName}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Date of birth</span>
          <span className="prefill-value">{dobDisplay}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Age</span>
          <span className="prefill-value">{flow.age || '—'}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Gender</span>
          <span className="prefill-value">{flow.gender ?? '—'}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Tobacco</span>
          <span className="prefill-value">{flow.tobacco ?? '—'}</span>
        </div>
      </div>

      <div className="prefill-card">
        <div className="prefill-header">
          <span className="prefill-title">Health screen results</span>
          <span className="prefill-badge">✓ Pre-filled</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Qualification score</span>
          <span className="prefill-value" style={{ color: 'var(--green)', fontWeight: 600 }}>
            {scoring.overall}%
          </span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Predicted rate class</span>
          <span className="prefill-value">{rateClassName}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Height / Weight</span>
          <span className="prefill-value">{heightDisplay}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Build class</span>
          <span className="prefill-value">{scoring.buildClassLabel}</span>
        </div>
      </div>

      <div className="prefill-card">
        <div className="prefill-header">
          <span className="prefill-title">Medications</span>
          <span className="prefill-badge">✓ Pre-filled</span>
        </div>
        {flow.meds.length === 0 ? (
          <div className="prefill-row">
            <span className="prefill-label">None reported</span>
            <span className="prefill-value">—</span>
          </div>
        ) : (
          flow.meds.map((m) => (
            <div key={m.name} className="prefill-row">
              <span className="prefill-label">{m.name}</span>
              <span className="prefill-value">
                {m.dose} · {m.statusText}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="prefill-card">
        <div className="prefill-header">
          <span className="prefill-title">Health questions</span>
          <span className="prefill-badge">✓ Pre-filled</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Knockout conditions</span>
          <span
            className="prefill-value"
            style={{ color: hasKnockouts ? 'var(--red-text)' : 'var(--green)' }}
          >
            {hasKnockouts ? 'Flagged' : 'None'}
          </span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Diabetes</span>
          <span className="prefill-value">{diabetesLabel}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Heart</span>
          <span className="prefill-value">{heartLabel}</span>
        </div>
        <div className="prefill-row">
          <span className="prefill-label">Other conditions</span>
          <span className="prefill-value">{otherFlags}</span>
        </div>
      </div>

      <div className="info-callout">
        <span className="info-icon">ℹ</span>
        <span className="info-text">
          <strong>Everything above was captured during your screening.</strong> If anything is incorrect, tap Back to fix
          it before proceeding.
        </span>
      </div>

      <button className="btn" onClick={onNext} type="button">
        Everything looks correct →
      </button>
    </Frame>
  );
}

// ─── Stage 2: Medicare ID + contact info ─────────────────────────

function formatMBI(raw: string): string {
  const v = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11);
  // Groups of 4-3-4 with dashes. 11 chars → 4-3-4.
  if (v.length <= 4) return v;
  if (v.length <= 7) return `${v.slice(0, 4)}-${v.slice(4)}`;
  return `${v.slice(0, 4)}-${v.slice(4, 7)}-${v.slice(7)}`;
}

function formatPhone(raw: string): string {
  const v = raw.replace(/\D/g, '').slice(0, 10);
  if (v.length === 0) return '';
  if (v.length <= 3) return `(${v}`;
  if (v.length <= 6) return `(${v.slice(0, 3)}) ${v.slice(3)}`;
  return `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`;
}

function formatDate(raw: string): string {
  const v = raw.replace(/\D/g, '').slice(0, 8);
  if (v.length <= 2) return v;
  if (v.length <= 4) return `${v.slice(0, 2)}/${v.slice(2)}`;
  return `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
}

interface DetailsStageProps {
  onNext: () => void;
  onBack: () => void;
}

function DetailsStage({ onNext, onBack }: DetailsStageProps) {
  const flow = useFlow();
  const app = flow.application;

  const canContinue =
    app.firstName.trim() !== '' &&
    app.lastName.trim() !== '' &&
    app.mbi.replace(/-/g, '').length === 11 &&
    app.securityPin.length === 4 &&
    app.phone.replace(/\D/g, '').length === 10 &&
    /.+@.+\..+/.test(app.email) &&
    app.addressLine.trim() !== '' &&
    app.city.trim() !== '' &&
    app.zip.length === 5;

  return (
    <Frame tag="APPLICATION" hideDots>
      <BackRow onClick={onBack} />
      <div className="step-label">Application · Medicare & contact info</div>
      <h1 className="headline">
        A few more <em>details.</em>
      </h1>
      <div className="sub-text">
        We need your legal name, Medicare ID, and contact information to complete the application.
      </div>

      <div className="sec-label">Legal name</div>
      <div className="fi-row">
        <div style={{ flex: 1 }}>
          <div className="fi-label">First name</div>
          <input
            className="fi"
            placeholder="James"
            value={app.firstName}
            onChange={(e) => flow.updateApplication({ firstName: e.target.value })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className="fi-label">Last name</div>
          <input
            className="fi"
            placeholder="Wilson"
            value={app.lastName}
            onChange={(e) => flow.updateApplication({ lastName: e.target.value })}
          />
        </div>
      </div>

      <div className="medicare-id-card">
        <div className="medicare-id-title">Medicare Beneficiary Identifier (MBI)</div>
        <input
          className="medicare-id-input"
          placeholder="1EG4-TE5-MK72"
          maxLength={13}
          value={app.mbi}
          onChange={(e) => flow.updateApplication({ mbi: formatMBI(e.target.value) })}
        />
        <div className="medicare-id-hint">
          Find this on your red, white, and blue Medicare card. It's 11 characters — letters and numbers.
        </div>
      </div>

      <div className="sec-label">Create a security PIN</div>
      <input
        className="fi mono pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        placeholder="••••"
        maxLength={4}
        value={app.securityPin}
        onChange={(e) =>
          flow.updateApplication({ securityPin: e.target.value.replace(/\D/g, '').slice(0, 4) })
        }
      />
      <div className="fi-hint">
        This PIN protects your Medicare ID. You'll need it if you call us about this application.
      </div>

      <div className="sec-label">Medicare effective dates</div>
      <div className="fi-row">
        <div style={{ flex: 1 }}>
          <div className="fi-label">Part A effective</div>
          <input
            className="fi mono"
            placeholder="06/01/2026"
            maxLength={10}
            value={app.partAEffective}
            onChange={(e) => flow.updateApplication({ partAEffective: formatDate(e.target.value) })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div className="fi-label">Part B effective</div>
          <input
            className="fi mono"
            placeholder="06/01/2026"
            maxLength={10}
            value={app.partBEffective}
            onChange={(e) => flow.updateApplication({ partBEffective: formatDate(e.target.value) })}
          />
        </div>
      </div>

      <div className="sec-label">Contact information</div>
      <div className="fi-label">Phone number</div>
      <input
        className="fi mono"
        placeholder="(919) 555-1234"
        inputMode="tel"
        maxLength={14}
        value={app.phone}
        onChange={(e) => flow.updateApplication({ phone: formatPhone(e.target.value) })}
      />
      <div className="fi-label" style={{ marginTop: 10 }}>
        Email
      </div>
      <input
        className="fi"
        placeholder="james@email.com"
        type="email"
        value={app.email}
        onChange={(e) => flow.updateApplication({ email: e.target.value })}
      />
      <div className="fi-label" style={{ marginTop: 10 }}>
        Mailing address
      </div>
      <input
        className="fi"
        placeholder="123 Main Street"
        value={app.addressLine}
        onChange={(e) => flow.updateApplication({ addressLine: e.target.value })}
      />
      <div className="fi-row" style={{ marginTop: 10 }}>
        <div style={{ flex: 2 }}>
          <input
            className="fi"
            placeholder="Durham"
            value={app.city}
            onChange={(e) => flow.updateApplication({ city: e.target.value })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <input
            className="fi"
            placeholder="NC"
            maxLength={2}
            value={app.state}
            onChange={(e) => flow.updateApplication({ state: e.target.value.toUpperCase() })}
          />
        </div>
        <div style={{ flex: 1 }}>
          <input
            className="fi mono"
            placeholder="27707"
            maxLength={5}
            value={app.zip || flow.zip}
            onChange={(e) =>
              flow.updateApplication({ zip: e.target.value.replace(/\D/g, '').slice(0, 5) })
            }
          />
        </div>
      </div>

      <div className="info-callout">
        <span className="info-icon">🔒</span>
        <span className="info-text">
          <strong>Your Medicare ID is encrypted</strong> and transmitted securely. It is only shared with the carrier you
          selected when your application is submitted.
        </span>
      </div>

      <button className="btn" onClick={onNext} disabled={!canContinue} type="button">
        Continue to authorization →
      </button>
    </Frame>
  );
}

// ─── Stage 3: Authorization + E-sign ─────────────────────────────

interface SignStageProps {
  onBack: () => void;
  carrierName: string;
}

function SignStage({ onBack, carrierName }: SignStageProps) {
  const navigate = useNavigate();
  const flow = useFlow();
  const app = flow.application;
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const authLines = useMemo(
    () => [
      <>
        I authorize <strong>Rob Simm (NPN #10447418)</strong> to act as my agent of record and submit this Medicare
        Supplement application to <strong>{carrierName}</strong> on my behalf.
      </>,
      <>
        I confirm that <strong>all information provided is true and complete</strong> to the best of my knowledge. I
        understand that inaccurate information may result in policy rescission or claim denial.
      </>,
      <>
        I authorize {carrierName} to <strong>access my medical records, prescription drug history, and MIB report</strong>{' '}
        for the purpose of underwriting this application.
      </>,
      <>
        I understand that <strong>this application is subject to underwriting</strong> and acceptance is not guaranteed.
        My final premium will be determined by {carrierName} based on their underwriting review. I consent to being
        contacted by Rob Simm via phone, text, or email regarding this application.
      </>,
    ],
    [carrierName],
  );

  const signed = app.signedAt !== null;
  const allChecked = app.authChecks.every((c) => c);
  const canSubmit = allChecked && signed;

  const signedLabel = app.signedAt
    ? `Signed ${new Date(app.signedAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })} at ${new Date(app.signedAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })}`
    : '';

  const fullName = `${app.firstName} ${app.lastName}`.trim() || 'Signature';

  const onSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await submitApplication(flow, flow.age);
      if (!result.ok) {
        const msg =
          result.errors?.map((e) => e.message).join(' ') ||
          'Something went wrong submitting your application. Please try again.';
        setSubmitError(msg);
        setSubmitting(false);
        return;
      }
      navigate('/embed/submitted');
    } catch (err) {
      console.error('[submit] failed:', err);
      setSubmitError('Network error — please check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <Frame tag="APPLICATION" hideDots>
      <BackRow onClick={onBack} />
      <div className="step-label">Application · Authorization</div>
      <h1 className="headline">
        Review and <em>sign.</em>
      </h1>
      <div className="sub-text">These authorizations are required by the carrier before your application can be submitted.</div>

      {authLines.map((line, i) => (
        <div key={i} className="auth-check" onClick={() => flow.toggleAuthCheck(i as 0 | 1 | 2 | 3)}>
          <div className={`auth-checkbox${app.authChecks[i] ? ' checked' : ''}`} />
          <div className="auth-text">{line}</div>
        </div>
      ))}

      <div className="sec-label" style={{ marginTop: 24 }}>
        Electronic signature
      </div>
      <div className="sub-text" style={{ marginBottom: 12 }}>
        Tap below to sign your name. This serves as your legal electronic signature.
      </div>

      <div
        className={`sig-pad${signed ? ' signed' : ''}`}
        onClick={() => {
          if (!signed) flow.sign();
        }}
      >
        {signed ? (
          <span className="sig-text">{fullName}</span>
        ) : (
          <span className="sig-placeholder">Tap to sign</span>
        )}
      </div>
      {signed && <div className="sig-date">{signedLabel}</div>}

      <button className="btn" onClick={onSubmit} disabled={!canSubmit || submitting} type="button">
        {submitting ? 'Submitting…' : 'Submit application →'}
      </button>

      {submitError && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 'var(--radius-md)',
            background: 'rgba(220, 38, 38, 0.08)',
            color: 'var(--red-text)',
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          {submitError}
        </div>
      )}

      <div className="disclaimer">
        <span className="privacy-badge">🔒 E-Sign Act compliant</span>
        <br />
        Your electronic signature has the same legal force as a handwritten signature under the Electronic Signatures in
        Global and National Commerce Act (E-Sign Act). Your application data is encrypted in transit and at rest.
      </div>
    </Frame>
  );
}
