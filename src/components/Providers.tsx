import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { BackRow, Frame } from './Frame';

export function Providers() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [name, setName] = useState('');

  const trimmed = name.trim();
  const canAdd =
    trimmed.length > 0 &&
    !flow.providers.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  const onAdd = () => {
    if (!canAdd) return;
    flow.addProvider({ name: trimmed });
    setName('');
  };

  const onContinue = () => navigate('/health');

  return (
    <Frame step={4}>
      <BackRow onClick={() => navigate('/meds')} />
      <div className="step-label">Step 4 of 6 · Your doctors</div>
      <h1 className="headline">
        Who are <em>your</em> doctors?
      </h1>
      <div className="sub-text">
        Supplement plans work with any doctor who accepts Medicare — no networks. We collect this for your file so we can
        serve you better.
      </div>

      <div className="search-wrap">
        <svg
          className="search-icon"
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="11" cy="11" r={8} />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="search-input"
          placeholder="Doctor's name (e.g. Dr. Sarah Chen)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onAdd();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={onAdd}
          disabled={!canAdd}
          style={{ marginLeft: 8, marginTop: 0, width: 'auto', padding: '0 16px' }}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: 8 }}>
        {flow.providers.map((p, i) => (
          <div key={`${p.name}-${i}`} className="item-card">
            <div className="item-dot safe" />
            <div className="item-info">
              <div className="item-name">{p.name}</div>
              <span className="item-sub safe">On file</span>
            </div>
            <button
              className="item-remove"
              onClick={() => flow.removeProvider(i)}
              type="button"
              aria-label={`Remove ${p.name}`}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {flow.providers.length === 0 ? (
        <button className="skip-link" onClick={onContinue} type="button">
          Skip — I'll add doctors later
        </button>
      ) : (
        <button className="btn" onClick={onContinue} type="button">
          Continue to health screen →
        </button>
      )}

      <div className="disclaimer">
        <span className="privacy-badge">🔒 For your file only</span>
        <br />
        Medicare Supplement plans have no provider networks. Any doctor who accepts Medicare accepts your supplement.
      </div>
    </Frame>
  );
}
