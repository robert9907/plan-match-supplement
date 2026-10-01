import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { classifyBuild, buildClassDescription, HEIGHT_OPTIONS } from '../lib/buildChart';
import {
  scoreApplication,
  type HealthAnswers,
  type HealthQuestionKey,
  type YesNo,
} from '../lib/scoringEngine';
import { prefetchRates } from '../lib/cmsPremiums';
import { BackRow, Frame } from './Frame';

interface Question {
  key: HealthQuestionKey;
  text: ReactNode;
  hint?: string;
}

interface Section {
  id: string;
  title: string;
  hint: string;
  questions: Question[];
}

// Plain-language versions of what Medigap carriers ask on their applications,
// grouped so a healthy applicant can clear a whole block with one tap.
// QA drives this screen by `.hq` position — diabetes must stay at index 6.
const SECTIONS: Section[] = [
  {
    id: 'care',
    title: 'Care you’re getting now',
    hint: 'Today or within the past 3 months',
    questions: [
      { key: 'q1_hospitalized', text: <>In the <strong>hospital</strong>, <strong>bedridden</strong>, or living in a <strong>nursing home or assisted living</strong>?</> },
      { key: 'q13_adl', text: <>Need <strong>help bathing, dressing, or eating</strong> — or use a <strong>wheelchair, walker, or scooter</strong>?</> },
      { key: 'q2_hospice', text: <>Receiving <strong>hospice</strong>, <strong>home health care</strong>, or <strong>oxygen</strong>?</> },
      { key: 'q14_therapy', text: <><strong>Physical, occupational, or speech therapy</strong>?</> },
      { key: 'q12_pending', text: <><strong>Surgery, a hospital stay, or tests</strong> your doctor recommended that haven’t happened yet?</> },
      { key: 'q3_dialysis', text: <><strong>Dialysis</strong>, or told you have <strong>kidney failure</strong>?</> },
    ],
  },
  {
    id: 'heart',
    title: 'Diabetes, heart & circulation',
    hint: 'Ever diagnosed or treated, unless noted',
    questions: [
      { key: 'q7_diabetes', text: <><strong>Diabetes</strong>?</> },
      { key: 'q8_heart', text: <><strong>Heart disease</strong>, <strong>heart attack</strong>, <strong>angina</strong>, or a <strong>bypass or stent</strong>?</> },
      { key: 'q19_chf', text: <><strong>Congestive heart failure</strong>?</> },
      { key: 'q16_afib', text: <><strong>Atrial fibrillation</strong> (AFib)?</> },
      { key: 'q18_defib', text: <>An <strong>implanted defibrillator</strong> (ICD)?</>, hint: 'A pacemaker alone is a no' },
      { key: 'q15_stroke', text: <><strong>Stroke or mini-stroke</strong> (TIA) in the past 2 years?</> },
      { key: 'q17_circulation', text: <><strong>Poor circulation in your legs</strong> (PAD/PVD) or an <strong>aneurysm</strong>?</> },
    ],
  },
  {
    id: 'other',
    title: 'Other conditions',
    hint: 'Ever diagnosed or treated, unless noted',
    questions: [
      { key: 'q4_cancer', text: <><strong>Cancer</strong> in the past 2 years?</>, hint: 'Not basal or squamous cell skin cancer' },
      { key: 'q9_copd', text: <><strong>COPD, emphysema</strong>, or other chronic lung disease?</> },
      { key: 'q5_transplant', text: <><strong>Organ transplant</strong> — received, or on a waiting list?</> },
      { key: 'q6_als_hiv_hepc', text: <><strong>ALS</strong>, <strong>HIV/AIDS</strong>, or <strong>Hepatitis C</strong>?</> },
      { key: 'q10_neuro', text: <><strong>Parkinson’s</strong>, <strong>Alzheimer’s</strong>, or <strong>dementia</strong>?</> },
      { key: 'q11_mental', text: <><strong>Schizophrenia</strong> or <strong>bipolar disorder</strong>?</> },
      { key: 'q20_mobility', text: <><strong>Arthritis that limits getting around</strong>, or <strong>spinal stenosis</strong>?</> },
      { key: 'q21_bowel', text: <><strong>Crohn’s disease</strong> or <strong>ulcerative colitis</strong>?</> },
      { key: 'q22_substance', text: <>Treated for <strong>alcohol or drug use</strong> in the past 5 years?</> },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap((s) => s.questions);

const DIABETES_OPTIONS: { value: HealthAnswers['diabetesMgmt']; label: string }[] = [
  { value: 'diet', label: 'Diet' },
  { value: 'oral', label: 'Pills' },
  { value: 'u50', label: '<50u insulin' },
  { value: 'o50', label: '50u+' },
];

const HEART_OPTIONS: { value: HealthAnswers['heartRecency']; label: string }[] = [
  { value: 'o2', label: '2+ yrs ago' },
  { value: 'u2', label: '<2 yrs' },
  { value: 'now', label: 'Current' },
];

export function HealthScreen() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [scoring, setScoring] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const h = flow.health;

  const answerQ = (key: HealthQuestionKey, value: YesNo) => {
    flow.setHealth((prev) => {
      const next = { ...prev, [key]: value };
      // A "No" clears that question's follow-ups so stale detail can't score.
      if (key === 'q7_diabetes' && value === 'n') {
        next.diabetesMgmt = null;
        next.diabetesComplications = null;
      }
      if (key === 'q8_heart' && value === 'n') next.heartRecency = null;
      return next;
    });
  };

  const noneInSection = (section: Section) => {
    section.questions.forEach((q) => answerQ(q.key, 'n'));
  };

  const buildCls = useMemo(
    () => (flow.heightIn && flow.weightLbs ? classifyBuild(flow.heightIn, flow.weightLbs) : null),
    [flow.heightIn, flow.weightLbs],
  );
  const buildDesc = buildCls ? buildClassDescription(buildCls) : null;

  const answeredCount = ALL_QUESTIONS.filter((q) => h[q.key] !== null).length;
  const askComplications = h.q7_diabetes === 'y' && h.diabetesMgmt !== null && h.diabetesMgmt !== 'diet';
  const diabetesFilled =
    h.q7_diabetes !== 'y' || (h.diabetesMgmt !== null && (!askComplications || h.diabetesComplications !== null));
  const heartFilled = h.q8_heart !== 'y' || h.heartRecency !== null;
  const canContinue = answeredCount === ALL_QUESTIONS.length && diabetesFilled && heartFilled;
  const remaining = ALL_QUESTIONS.length - answeredCount;

  const onContinue = async () => {
    if (!canContinue || !flow.gender || !flow.tobacco || scoring) return;
    setScoreError(null);
    setScoring(true);
    try {
      // Rates were prefetched on About → this await is usually instant.
      await prefetchRates(flow.zip, flow.gender === 'Female' ? 'FEMALE' : 'MALE');
      const result = scoreApplication({
        age: flow.age,
        gender: flow.gender,
        tobacco: flow.tobacco,
        zip: flow.zip,
        meds: flow.meds,
        health: h,
        heightIn: flow.heightIn,
        weightLbs: flow.weightLbs,
        oep: false,
      });
      flow.setScoring(result);
      navigate('/results');
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : 'Could not load rates');
      setScoring(false);
    }
  };

  return (
    <Frame step={4}>
      <BackRow onClick={() => navigate('/providers')} />
      <div className="step-label">Step 5 of 6 · Health screen</div>
      <h1 className="headline">
        Quick health <em>check.</em>
      </h1>
      <div className="sub-text">
        {ALL_QUESTIONS.length} quick questions. If none apply in a group, one tap clears it. A “yes” doesn’t always mean a
        decline.
      </div>

      {SECTIONS.map((section) => {
        const sectionAnswered = section.questions.filter((q) => h[q.key] !== null).length;
        const allNo = section.questions.every((q) => h[q.key] === 'n');
        return (
          <section key={section.id} className="hq-group" aria-labelledby={`hq-${section.id}`}>
            <header className="hq-group-head">
              <div>
                <div id={`hq-${section.id}`} className="hq-group-title">
                  {section.title}
                </div>
                <div className="hq-group-hint">{section.hint}</div>
              </div>
              <button
                type="button"
                className={`hq-none${allNo ? ' on' : ''}`}
                onClick={() => noneInSection(section)}
                aria-pressed={allNo}
              >
                {allNo ? '✓ None apply' : 'None of these'}
              </button>
            </header>
            <div className="hq-group-count">
              {sectionAnswered}/{section.questions.length} answered
            </div>

            {section.questions.map((q) => {
              const value = h[q.key];
              return (
                <div key={q.key} className={`hq${value === 'y' ? ' is-yes' : ''}`}>
                  <div className="hq-text">
                    {q.text}
                    {q.hint && <span className="hq-hint">{q.hint}</span>}
                  </div>
                  <div className="hq-btns" role="group" aria-label="Answer">
                    <button
                      type="button"
                      className={`hq-btn${value === 'y' ? ' yes' : ''}`}
                      aria-pressed={value === 'y'}
                      onClick={() => answerQ(q.key, 'y')}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      className={`hq-btn${value === 'n' ? ' no' : ''}`}
                      aria-pressed={value === 'n'}
                      onClick={() => answerQ(q.key, 'n')}
                    >
                      No
                    </button>
                  </div>

                  {q.key === 'q7_diabetes' && value === 'y' && (
                    <div className="slider-wrap">
                      <div className="sl">How is it managed?</div>
                      <div className="slider-opts">
                        {DIABETES_OPTIONS.map((opt) => (
                          <button
                            key={opt.value ?? 'none'}
                            type="button"
                            className={`sopt${h.diabetesMgmt === opt.value ? ' sel' : ''}`}
                            onClick={() =>
                              flow.setHealth((p) => ({
                                ...p,
                                diabetesMgmt: opt.value,
                                // Complications are only asked for medication/insulin management.
                                diabetesComplications: opt.value === 'diet' ? null : p.diabetesComplications,
                              }))
                            }
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {askComplications && (
                        <>
                          <div className="sl" style={{ marginTop: 10 }}>
                            Any eye, nerve, kidney, or circulation complications?
                          </div>
                          <div className="slider-opts">
                            {(['y', 'n'] as const).map((v) => (
                              <button
                                key={v}
                                type="button"
                                className={`sopt${h.diabetesComplications === v ? ' sel' : ''}`}
                                onClick={() => flow.setHealth((p) => ({ ...p, diabetesComplications: v }))}
                              >
                                {v === 'y' ? 'Yes' : 'No'}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {q.key === 'q8_heart' && value === 'y' && (
                    <div className="slider-wrap">
                      <div className="sl">When was the last event or treatment?</div>
                      <div className="slider-opts">
                        {HEART_OPTIONS.map((opt) => (
                          <button
                            key={opt.value ?? 'none'}
                            type="button"
                            className={`sopt${h.heartRecency === opt.value ? ' sel' : ''}`}
                            onClick={() => flow.setHealth((p) => ({ ...p, heartRecency: opt.value }))}
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
          </section>
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
            {HEIGHT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
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

      <button className="btn" onClick={onContinue} disabled={!canContinue || scoring} type="button">
        {scoring ? 'Loading rates…' : 'Check my qualification →'}
      </button>
      {!canContinue && (
        <div className="hq-remaining">
          {remaining > 0
            ? `${remaining} question${remaining === 1 ? '' : 's'} left`
            : 'Finish the follow-up under your “yes” answer'}
        </div>
      )}
      {scoreError && (
        <div className="combo-alert" style={{ marginTop: 8 }}>
          <b>⚠ Could not load carrier rates</b>
          <span>{scoreError}. Please try again.</span>
        </div>
      )}

      <div className="disclaimer">
        <span className="privacy-badge">🔒 Confidential</span>
        <br />
        Screened locally in your browser. Never transmitted to any carrier. Your agent does not make acceptance decisions.
      </div>
    </Frame>
  );
}
