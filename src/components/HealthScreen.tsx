import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { classifyBuild, buildClassDescription, HEIGHT_OPTIONS } from '../lib/buildChart';
import { scoreApplication, type HealthAnswers, type YesNo } from '../lib/scoringEngine';
import { BackRow, Frame } from './Frame';

type QuestionKey = Exclude<keyof HealthAnswers, 'diabetesMgmt' | 'heartRecency'>;

interface Question {
  key: QuestionKey;
  n: number;
  text: React.ReactNode;
}

const QUESTIONS: Question[] = [
  { key: 'q1_hospitalized', n: 1, text: <>Currently <strong>hospitalized, bedridden, or wheelchair</strong>?</> },
  { key: 'q2_hospice', n: 2, text: <>Receiving <strong>hospice, home health, or oxygen</strong>?</> },
  { key: 'q3_dialysis', n: 3, text: <><strong>Dialysis</strong> or <strong>kidney failure</strong>?</> },
  { key: 'q4_cancer', n: 4, text: <><strong>Cancer</strong> in past 2 years? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(not basal/squamous skin)</span></> },
  { key: 'q5_transplant', n: 5, text: <><strong>Organ transplant</strong> — received or waiting?</> },
  { key: 'q6_als_hiv_hepc', n: 6, text: <><strong>ALS, AIDS/HIV, or Hepatitis C</strong>?</> },
  { key: 'q7_diabetes', n: 7, text: <><strong>Diabetes</strong>?</> },
  { key: 'q8_heart', n: 8, text: <><strong>Heart disease, heart attack, or bypass</strong>?</> },
  { key: 'q9_copd', n: 9, text: <><strong>COPD, emphysema, pulmonary disease</strong>?</> },
  { key: 'q10_neuro', n: 10, text: <><strong>Parkinson's, Alzheimer's, dementia</strong>?</> },
  { key: 'q11_mental', n: 11, text: <><strong>Schizophrenia or bipolar</strong>?</> },
  { key: 'q12_pending', n: 12, text: <><strong>Pending surgery</strong> or unresolved tests?</> },
];

const DIABETES_OPTIONS: { value: HealthAnswers['diabetesMgmt']; label: string }[] = [
  { value: 'diet', label: 'Diet' },
  { value: 'oral', label: 'Oral' },
  { value: 'u50', label: '<50u' },
  { value: 'o50', label: '50u+' },
];

const HEART_OPTIONS: { value: HealthAnswers['heartRecency']; label: string }[] = [
  { value: 'o2', label: '2+ yrs' },
  { value: 'u2', label: '<2 yrs' },
  { value: 'now', label: 'Current' },
];

export function HealthScreen() {
  const navigate = useNavigate();
  const flow = useFlow();

  const answerQ = (key: QuestionKey, value: YesNo) => {
    flow.setHealth((h) => ({ ...h, [key]: value }));
  };

  const buildCls = useMemo(
    () => (flow.heightIn && flow.weightLbs ? classifyBuild(flow.heightIn, flow.weightLbs) : null),
    [flow.heightIn, flow.weightLbs],
  );
  const buildDesc = buildCls ? buildClassDescription(buildCls) : null;

  const allAnswered = QUESTIONS.every((q) => flow.health[q.key] !== null);
  const diabetesSliderFilled = flow.health.q7_diabetes !== 'y' || flow.health.diabetesMgmt !== null;
  const heartSliderFilled = flow.health.q8_heart !== 'y' || flow.health.heartRecency !== null;
  const canContinue = allAnswered && diabetesSliderFilled && heartSliderFilled;

  const onContinue = () => {
    if (!canContinue || !flow.gender || !flow.tobacco) return;
    const scoring = scoreApplication({
      age: flow.age,
      gender: flow.gender,
      tobacco: flow.tobacco,
      meds: flow.meds,
      health: flow.health,
      heightIn: flow.heightIn,
      weightLbs: flow.weightLbs,
      oep: false,
    });
    flow.setScoring(scoring);
    navigate('/embed/results');
  };

  return (
    <Frame step={3}>
      <BackRow onClick={() => navigate('/embed/meds')} />
      <div className="step-label">Step 3 of 4 · Health screen</div>
      <h1 className="headline">
        Quick health <em>check.</em>
      </h1>
      <div className="sub-text">12 questions — a "yes" doesn't always mean a decline.</div>

      {QUESTIONS.map((q) => {
        const value = flow.health[q.key];
        return (
          <div key={q.key} className="hq">
            <div className="hq-text">
              {q.n}. {q.text}
            </div>
            <div className="hq-btns">
              <button
                type="button"
                className={`hq-btn${value === 'y' ? ' yes' : ''}`}
                onClick={() => answerQ(q.key, 'y')}
              >
                Yes
              </button>
              <button
                type="button"
                className={`hq-btn${value === 'n' ? ' no' : ''}`}
                onClick={() => answerQ(q.key, 'n')}
              >
                No
              </button>
            </div>

            {q.key === 'q7_diabetes' && flow.health.q7_diabetes === 'y' && (
              <div className="slider-wrap">
                <div className="sl">How managed?</div>
                <div className="slider-opts">
                  {DIABETES_OPTIONS.map((opt) => (
                    <button
                      key={opt.value ?? 'none'}
                      type="button"
                      className={`sopt${flow.health.diabetesMgmt === opt.value ? ' sel' : ''}`}
                      onClick={() => flow.setHealth((h) => ({ ...h, diabetesMgmt: opt.value }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {q.key === 'q8_heart' && flow.health.q8_heart === 'y' && (
              <div className="slider-wrap">
                <div className="sl">When?</div>
                <div className="slider-opts">
                  {HEART_OPTIONS.map((opt) => (
                    <button
                      key={opt.value ?? 'none'}
                      type="button"
                      className={`sopt${flow.health.heartRecency === opt.value ? ' sel' : ''}`}
                      onClick={() => flow.setHealth((h) => ({ ...h, heartRecency: opt.value }))}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="sec-label">Height & Weight</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <select
            className="fi"
            value={flow.heightIn ?? ''}
            onChange={(e) => flow.setHeight(e.target.value ? Number(e.target.value) : null)}
            aria-label="Height"
          >
            <option value="">Height</option>
            {HEIGHT_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <input
            className="fi mono"
            placeholder="Weight (lbs)"
            maxLength={3}
            inputMode="numeric"
            value={flow.weightLbs ?? ''}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '');
              flow.setWeight(v ? Number(v) : null);
            }}
          />
        </div>
      </div>
      {buildDesc && <div className={`build-res ${buildDesc.tone}`}>{buildDesc.label}</div>}

      <button className="btn" onClick={onContinue} disabled={!canContinue} type="button">
        Check my qualification →
      </button>

      <div className="disclaimer">
        <span className="privacy-badge">🔒 Confidential</span>
        <br />
        Screened locally in your browser. Never transmitted to any carrier. Your agent does not make acceptance decisions.
      </div>
    </Frame>
  );
}
