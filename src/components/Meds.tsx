import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import {
  drugDisplayDetail,
  drugDisplayName,
  searchDrugs,
  type DrugSearchResult,
  MIN_SEARCH_CHARS,
} from '../lib/drugSearch';
import { classifyMed, type MedItem } from '../lib/scoringEngine';
import { BackRow, Frame } from './Frame';
import { PillScanSheet } from './PillScanSheet';

const SEARCH_DEBOUNCE_MS = 250;

export function Meds() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<DrugSearchResult[]>([]);
  const [scanOpen, setScanOpen] = useState(false);

  // Debounced lookup against the shared library API. AbortController
  // cancels in-flight fetches when the query changes so a slow response
  // can't stomp a newer match list.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SEARCH_CHARS) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      searchDrugs(q, controller.signal, 5)
        .then((drugs) => setMatches(drugs))
        .catch(() => {
          // Aborted or network error — keep prior matches rather than
          // flicker the dropdown empty on transient failure.
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [query]);

  const addDrug = (d: DrugSearchResult) => {
    const name = drugDisplayName(d);
    const classification = classifyMed(name);
    const med: MedItem = {
      name,
      dose: d.strength,
      rxcui: d.rxcui,
      ...classification,
    };
    flow.addMed(med);
    setQuery('');
    setMatches([]);
  };

  // Single funnel for any add path (search pick, free-typed entry, or
  // scan confirmation). classifyMed runs the DDL lookup by first
  // lowercased token, so this works for ad-hoc names too. For the OCR
  // path we try to resolve a real rxcui against the shared library
  // before storing — combo scoring rules that need a generic name
  // ("insulin glargine" → insulin cluster) can match on it.
  const addByName = async (name: string, dose: string) => {
    const classification = classifyMed(name);
    let resolvedRxcui: string | undefined;
    try {
      const drugs = await searchDrugs(name, undefined, 1);
      resolvedRxcui = drugs[0]?.rxcui;
    } catch {
      // Network glitch — fall through with rxcui undefined; the
      // ad-hoc add path still works without the library.
    }
    const med: MedItem = {
      name,
      dose,
      ...(resolvedRxcui ? { rxcui: resolvedRxcui } : {}),
      ...classification,
    };
    flow.addMed(med);
  };

  const flaggedMeds = flow.meds.filter((m) => m.status === 'flag');

  const onContinue = () => navigate('/providers');

  return (
    <Frame step={3}>
      <BackRow onClick={() => navigate('/rates')} />
      <div className="step-label">Step 3 of 6 · Medications</div>
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
            <div key={d.rxcui} className="ac-item" onClick={() => addDrug(d)}>
              <div className="ac-name">{drugDisplayName(d)}</div>
              <div className="ac-detail">{drugDisplayDetail(d)}</div>
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
          Continue to doctors →
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
          onConfirm={(drugs) => {
            for (const { name, dose } of drugs) void addByName(name, dose);
            setScanOpen(false);
          }}
        />
      )}
    </Frame>
  );
}
