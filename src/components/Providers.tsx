import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import {
  MIN_SEARCH_CHARS,
  providerAddress,
  providerDisplayDetail,
  providerDisplayName,
  searchProviders,
  type ProviderSearchResult,
} from '../lib/providerSearch';
import { BackRow, Frame } from './Frame';

const SEARCH_DEBOUNCE_MS = 250;

export function Providers() {
  const navigate = useNavigate();
  const flow = useFlow();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ProviderSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const trimmed = query.trim();
  const canAddFreeText =
    trimmed.length > 0 &&
    !flow.providers.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());

  // Debounced NPI Registry lookup. Mirrors Meds.tsx exactly — same
  // debounce, same AbortController so a slow response can't stomp a
  // newer match list.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_SEARCH_CHARS) {
      setMatches([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const t = window.setTimeout(() => {
      // Only ApplicationData carries a state; it defaults to 'NC' and the
      // applicant hasn't reached the address form at this step, so this is
      // a ranking hint, never a filter (the server treats it that way too).
      searchProviders(q, flow.application.state, controller.signal, 5)
        .then((providers) => setMatches(providers))
        .catch(() => {
          // Aborted or offline — keep prior matches rather than flicker
          // the dropdown empty. Free-text add below still works.
        })
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [query, flow.application.state]);

  // Search pick — carries the NPI, which is what AgentBase matches on.
  const addFromSearch = (p: ProviderSearchResult) => {
    const address = providerAddress(p);
    flow.addProvider({
      name: providerDisplayName(p),
      npi: p.npi,
      ...(p.specialty_display || p.specialty
        ? { specialty: p.specialty_display || p.specialty }
        : {}),
      ...(address ? { address } : {}),
    });
    setQuery('');
    setMatches([]);
  };

  // Free-text fallback — kept because the registry can be down, and
  // because plenty of people know "Dr. Chen" and not much else. Lands
  // with npi undefined; AgentBase falls back to normalized-name match.
  const addFreeText = () => {
    if (!canAddFreeText) return;
    flow.addProvider({ name: trimmed });
    setQuery('');
    setMatches([]);
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
        Supplement plans work with any doctor who accepts Medicare — no networks to check. Adding them here means Rob
        has your care team on file from day one, so nothing gets re-asked later.
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
          placeholder="Doctor's name (e.g. Sarah Chen)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Enter takes the top match when there is one, so the
              // fast path still resolves an NPI.
              if (matches.length > 0) addFromSearch(matches[0]);
              else addFreeText();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={addFreeText}
          disabled={!canAddFreeText}
          style={{ marginLeft: 8, marginTop: 0, width: 'auto', padding: '0 16px' }}
        >
          Add
        </button>
      </div>

      {matches.length > 0 && (
        <div className="ac">
          {matches.map((p) => (
            <div key={p.npi} className="ac-item" onClick={() => addFromSearch(p)}>
              <div className="ac-name">{providerDisplayName(p)}</div>
              <div className="ac-detail">{providerDisplayDetail(p)}</div>
            </div>
          ))}
        </div>
      )}
      {matches.length === 0 && !searching && trimmed.length >= MIN_SEARCH_CHARS && (
        <div className="ac-detail" style={{ marginTop: 6 }}>
          No registry match — press Add to save “{trimmed}” as typed.
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {flow.providers.map((p, i) => (
          <div key={`${p.name}-${i}`} className="item-card">
            <div className="item-dot safe" />
            <div className="item-info">
              <div className="item-name">{p.name}</div>
              <span className="item-sub safe">
                {[p.specialty, p.npi ? 'Verified' : 'On file'].filter(Boolean).join(' · ')}
              </span>
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
