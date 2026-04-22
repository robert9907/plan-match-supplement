import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow, type PromptReason } from '../context/FlowContext';
import { BackRow, Frame } from './Frame';

const PROMPTS: Exclude<PromptReason, null>[] = [
  'Turning 65',
  'Switching plans',
  'Leaving MA',
  'Rate increase',
  'Exploring',
];

const PROMPT_EXPLAINERS: Record<Exclude<PromptReason, null>, { icon: string; text: React.ReactNode }> = {
  'Turning 65': {
    icon: '✓',
    text: (
      <>
        <strong>Open Enrollment Period</strong> — 6-month window when you turn 65 with Part B. Every carrier must accept you
        at standard rates. No health questions.
      </>
    ),
  },
  'Switching plans': {
    icon: '⚠',
    text: (
      <>
        <strong>Medical underwriting applies.</strong> Carriers will review your health, medications, and weight before
        accepting you.
      </>
    ),
  },
  'Leaving MA': {
    icon: '⚠',
    text: (
      <>
        <strong>Trial right may apply.</strong> If you've been on MA less than 12 months, you may have guaranteed issue
        rights. Otherwise, underwriting applies.
      </>
    ),
  },
  'Rate increase': {
    icon: '⚠',
    text: (
      <>
        <strong>Shopping for a better rate.</strong> Switching carriers requires medical underwriting. Let's see who will
        accept you.
      </>
    ),
  },
  Exploring: {
    icon: 'ℹ',
    text: (
      <>
        <strong>No pressure.</strong> See what you qualify for and what it would cost. No application submitted without
        your say-so.
      </>
    ),
  },
};

const SHOW_MA_CROSSSELL: PromptReason[] = ['Exploring', 'Leaving MA', 'Switching plans'];

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1));

// 1930 → 1970 newest first — Medicare Supplement is ~Medicare-age only.
const YEAR_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let y = 1970; y >= 1930; y--) out.push(String(y));
  return out;
})();

export function About() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [maDismissed, setMaDismissed] = useState(false);

  const canContinue =
    flow.prompt !== null &&
    flow.dob.month !== '' &&
    flow.dob.day !== '' &&
    flow.dob.year !== '' &&
    flow.gender !== null &&
    flow.tobacco !== null &&
    flow.zip.length === 5;

  const ageMessage = useMemo(() => {
    if (flow.age <= 0) return null;
    if (flow.age < 60) {
      return { tone: 'warn' as const, text: `Age ${flow.age} — Medicare Supplement requires Medicare enrollment (usually 65+).` };
    }
    if (flow.age < 65) {
      return { tone: 'warn' as const, text: `Age ${flow.age} — some carriers require age 65+ for Supplement.` };
    }
    return { tone: 'ok' as const, text: `Age ${flow.age} — Medicare eligible` };
  }, [flow.age]);

  useEffect(() => {
    if (flow.prompt && !SHOW_MA_CROSSSELL.includes(flow.prompt)) setMaDismissed(false);
  }, [flow.prompt]);

  const onContinue = () => {
    if (!canContinue) return;
    if (flow.prompt === 'Turning 65') {
      // OEP bypass — skip Meds + Health, go straight to Results.
      navigate('/embed/results');
    } else {
      navigate('/embed/meds');
    }
  };

  return (
    <Frame step={1}>
      <BackRow onClick={() => navigate(-1)} />
      <div className="step-label">Step 1 of 4 · About you</div>
      <h1 className="headline">
        You deserve the right <em>coverage.</em>
      </h1>

      <div className="sec-label">
        What's prompting this? <span className="sec-hint">(tap one)</span>
      </div>
      <div className="chip-row">
        {PROMPTS.map((p) => (
          <button
            key={p}
            className={`chip${flow.prompt === p ? ' sel' : ''}`}
            onClick={() => flow.setPrompt(p)}
            type="button"
          >
            {p}
          </button>
        ))}
      </div>

      {flow.prompt && (
        <div className="green-explainer">
          <span className="ge-check">{PROMPT_EXPLAINERS[flow.prompt].icon}</span>
          <span className="ge-text">{PROMPT_EXPLAINERS[flow.prompt].text}</span>
        </div>
      )}

      <div className="info-callout">
        <span className="info-icon">ℹ</span>
        <span className="info-text">
          <strong>Why we ask</strong> · Your situation determines whether carriers can ask health questions. Turning 65 =
          guaranteed issue (no underwriting). Everyone else = medical underwriting applies.
        </span>
      </div>

      {flow.prompt && SHOW_MA_CROSSSELL.includes(flow.prompt) && !maDismissed && (
        <div className="cross-sell">
          <button
            className="cross-sell-close"
            onClick={() => setMaDismissed(true)}
            type="button"
            aria-label="Dismiss"
          >
            ×
          </button>
          <div className="cross-sell-title">Considering Medicare Advantage?</div>
          <div className="cross-sell-body">
            Medicare Advantage plans accept everyone regardless of health — no underwriting, no health questions. They also
            cover prescriptions, dental, vision, and hearing in one plan.
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

      <div className="sec-label">Date of birth</div>
      <div className="dob-row">
        <select
          value={flow.dob.month}
          onChange={(e) => flow.setDob({ ...flow.dob, month: e.target.value })}
          aria-label="Birth month"
        >
          <option value="">Month</option>
          {MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={flow.dob.day}
          onChange={(e) => flow.setDob({ ...flow.dob, day: e.target.value })}
          aria-label="Birth day"
        >
          <option value="">Day</option>
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={flow.dob.year}
          onChange={(e) => flow.setDob({ ...flow.dob, year: e.target.value })}
          aria-label="Birth year"
        >
          <option value="">Year</option>
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      {ageMessage && <div className={`age-callout ${ageMessage.tone}`}>{ageMessage.text}</div>}

      <div className="sec-label">Gender</div>
      <div className="chip-row">
        {(['Male', 'Female'] as const).map((g) => (
          <button
            key={g}
            className={`chip${flow.gender === g ? ' sel' : ''}`}
            onClick={() => flow.setGender(g)}
            type="button"
          >
            {g}
          </button>
        ))}
      </div>

      <div className="sec-label">Tobacco use in last 12 months?</div>
      <div className="chip-row">
        {(['Yes', 'No'] as const).map((t) => (
          <button
            key={t}
            className={`chip${flow.tobacco === t ? ' sel' : ''}`}
            onClick={() => flow.setTobacco(t)}
            type="button"
          >
            {t}
          </button>
        ))}
      </div>

      <div className="sec-label">ZIP code</div>
      <input
        className="fi mono"
        placeholder="27707"
        maxLength={5}
        inputMode="numeric"
        style={{ width: 120 }}
        value={flow.zip}
        onChange={(e) => flow.setZip(e.target.value.replace(/\D/g, ''))}
      />

      <button className="btn" onClick={onContinue} disabled={!canContinue} type="button">
        {flow.prompt === 'Turning 65' ? 'See your guaranteed plans →' : 'Continue to medications →'}
      </button>

      <div className="disclaimer">
        <span className="privacy-badge">🔒 Private</span>
        <br />
        Rob Simm, NPN #10447418, licensed independent agent. Not connected with or endorsed by the U.S. Government or
        Medicare.
      </div>
    </Frame>
  );
}
