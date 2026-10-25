// "What does this mean?" — Level 1 of the Explain → Ask Sarah → Talk to Rob
// layer. A pill next to a field label opens a short, pre-written snapshot in
// place. No AI, no network call. Content: src/lib/explainers.ts.
// Same component as plan-match-aca/src/components/shared/Explainer.tsx.
//
// Usage:
//   const promptHelp = useExplainer('supp.prompt');
//   <div className="sec-label">What's prompting this? {promptHelp.pill}</div>
//   {promptHelp.panel}

import { useId, useState, type ReactNode } from 'react';
import { getExplainer } from '../lib/explainers';

const T = {
  navy: '#0d2f5e',
  body: 'rgba(13, 47, 94, 0.78)',
  bg: '#f1fdfe',
  border: 'rgba(13, 47, 94, 0.14)',
  accent: '#0d6b75',
  white: '#ffffff',
};

function formatChecked(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function useExplainer(
  id: string,
  opts: { state?: string | null } = {},
): { pill: ReactNode; panel: ReactNode } {
  const explainer = getExplainer(id);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (!explainer) return { pill: null, panel: null };

  const pill = (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-controls={panelId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 32,
        padding: '0 12px',
        borderRadius: 100,
        border: `1px solid ${open ? T.accent : T.border}`,
        background: open ? T.accent : T.bg,
        color: open ? T.white : T.accent,
        fontFamily: "'DM Sans', sans-serif",
        textTransform: 'none',
        letterSpacing: 'normal',
        marginLeft: 8,
        verticalAlign: 'middle',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {open ? (
          <path d="M6 15l6-6 6 6" />
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5" />
            <path d="M12 8h.01" />
          </>
        )}
      </svg>
      {open ? 'Hide explanation' : 'What does this mean?'}
    </button>
  );

  const panel = open ? (
    <div
      id={panelId}
      role="region"
      aria-label={explainer.eyebrow}
      style={{
        margin: '4px 0 14px',
        border: `1.5px solid ${T.accent}`,
        borderRadius: 14,
        background: T.bg,
        padding: '16px 16px 14px',
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.12em', fontWeight: 700, color: T.accent, textTransform: 'uppercase' }}>
        {explainer.eyebrow}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
        {explainer.cards
          .filter((c) => !c.states || (opts.state != null && c.states.includes(opts.state)))
          .map((c) => (
          <div key={c.heading} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
            {c.tag && (
              <div style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: T.accent, background: T.bg, borderRadius: 6, padding: '3px 8px', marginBottom: 8 }}>
                {c.tag}
              </div>
            )}
            <div style={{ fontSize: 17, fontWeight: 700, color: T.navy }}>{c.heading}</div>
            <div style={{ fontSize: 17, lineHeight: 1.5, color: T.body, marginTop: 4 }}>{c.body}</div>
          </div>
        ))}
      </div>
      {explainer.callout && (
        <div style={{ marginTop: 10, background: T.white, border: `1px dashed ${T.accent}`, borderRadius: 10, padding: '10px 12px', fontSize: 17, color: T.navy, lineHeight: 1.5 }}>
          <strong>Good to know:</strong> {explainer.callout}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 14, color: T.body, lineHeight: 1.5 }}>
          Checked against{' '}
          {explainer.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && (i === explainer.sources.length - 1 ? ' and ' : ', ')}
              <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent }}>
                {s.label.split(' — ')[0]}
              </a>
            </span>
          ))}
          {' · '}Updated {formatChecked(explainer.checked)}
        </div>
        <a href="tel:+18287613326" style={{ fontSize: 16, fontWeight: 700, color: T.accent, textDecoration: 'none' }}>
          Still unsure? Call Rob · (828) 761-3326
        </a>
      </div>
    </div>
  ) : null;

  return { pill, panel };
}
