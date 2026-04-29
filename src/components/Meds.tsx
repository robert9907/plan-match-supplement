import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { DRUG_CATALOG, type DrugCatalogItem } from '../lib/ddlData';
import { classifyMed, type MedItem } from '../lib/scoringEngine';
import { BackRow, Frame } from './Frame';
import { PillScanSheet } from './PillScanSheet';

export function Meds() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [query, setQuery] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const matches = useMemo<DrugCatalogItem[]>(() => {
    if (query.trim().length < 2) return [];
    const q = query.toLowerCase();
    return DRUG_CATALOG.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 5);
  }, [query]);

  const addDrug = (d: DrugCatalogItem) => {
    const classification = classifyMed(d.name);
    const med: MedItem = {
      name: d.name,
      dose: d.dose,
      ...classification,
    };
    flow.addMed(med);
    setQuery('');
  };

  // Single funnel for any add path (search pick, free-typed entry, or
  // scan confirmation). DRUG_CATALOG dose wins when the user typed a
  // catalog name without a strength; the OCR-extracted strength wins
  // when the scan path passes one in. classifyMed runs the DDL lookup
  // by first lowercased token, so this works for ad-hoc names too.
  const addByName = (name: string, dose: string) => {
    const classification = classifyMed(name);
    const med: MedItem = {
      name,
      dose,
      ...classification,
    };
    flow.addMed(med);
  };

  const flaggedMeds = flow.meds.filter((m) => m.status === 'flag');

  const onContinue = () => navigate('/embed/health');

  return (
    <Frame step={2}>
      <BackRow onClick={() => navigate('/embed/about')} />
      <div className="step-label">Step 2 of 4 · Medications</div>
      <h1 className="headline">
        What medications do <em>you</em> take?
      </h1>
      <div className="sub-text">
        Certain prescriptions affect which carriers will accept you. We cross-check every drug against each carrier's
        underwriting list.
      </div>

      <button className="scan-pill" onClick={() => setScanOpen(true)} type="button">
        <span className="scan-pill-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <rect x="2" y="4" width="20" height="16" rx={2} />
            <circle cx="12" cy="12" r={3} />
          </svg>
        </span>
        Scan a pill bottle
      </button>

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
          placeholder="Or type a medication name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {matches.length > 0 && (
        <div className="ac">
          {matches.map((d) => (
            <div key={d.name} className="ac-item" onClick={() => addDrug(d)}>
              <div className="ac-name">{d.name}</div>
              <div className="ac-detail">{d.detail}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {flow.meds.map((m, i) => (
          <div key={m.name} className="item-card">
            <div className={`item-dot ${m.status}`} />
            <div className="item-info">
              <div className="item-name">{m.name}</div>
              <span className={`item-sub ${m.status}`}>{m.statusText}</span>
            </div>
            <button
              className="item-remove"
              onClick={() => flow.removeMed(i)}
              type="button"
              aria-label={`Remove ${m.name}`}
            >
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {flaggedMeds.length > 0 && (
        <div
          className="combo-alert"
          style={{
            marginTop: 10,
            background: 'var(--red-bg)',
            borderColor: 'var(--red-border)',
          }}
        >
          <b style={{ color: 'var(--red-text)' }}>⚠ Medication flag</b>
          <span style={{ color: 'var(--red-text)' }}>
            {flaggedMeds.map((m) => m.name).join(', ')} — on most carriers' declinable drug lists. Carrier-specific
            exceptions may still apply.
          </span>
        </div>
      )}

      {flow.meds.length === 0 ? (
        <button className="skip-link" onClick={onContinue} type="button">
          I don't take any medications
        </button>
      ) : (
        <button className="btn" onClick={onContinue} type="button">
          Continue to health screen →
        </button>
      )}

      <div className="disclaimer">
        <span className="privacy-badge">🔒 Not stored or shared</span>
        <br />
        Medications are screened locally. Nothing sent to any carrier without your consent. This is not medical advice.
      </div>

      {scanOpen && (
        <PillScanSheet
          onClose={() => setScanOpen(false)}
          onConfirm={({ name, dose }) => {
            addByName(name, dose);
            setScanOpen(false);
          }}
        />
      )}
    </Frame>
  );
}
