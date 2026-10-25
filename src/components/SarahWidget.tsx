// Ask Sarah — Rob's AI assistant as a side tool on the Supplement flow.
// "There when you want it": a small button in the corner, a panel that opens
// on tap (right-side panel on desktop, bottom sheet on a phone).
//
// The fence for Medigap: Sarah explains how Medigap works. She never takes or
// reviews health answers, never predicts acceptance, never quotes a rate —
// that's Rob. Hidden on /apply and /submitted (the application and its
// consents are not a place for a chat window).
//
// Brain: the shared web-Sarah endpoint on the Medicare app,
// planmatch.generationhealth.me/api/sarah-chat, in `supp` mode. Nothing is
// stored there; ID numbers are scrubbed server-side.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { EXPLAINERS } from '../lib/explainers';

const SARAH_ENDPOINT =
  (import.meta.env.VITE_SARAH_ENDPOINT as string | undefined) ||
  'https://planmatch.generationhealth.me/api/sarah-chat';

const HIDDEN_ON = new Set(['/apply', '/submitted']);

const T = {
  navy: '#0d2f5e',
  ink: '#0d2f5e',
  ink2: 'rgba(13, 47, 94, 0.75)',
  seafoam: '#83f0f9',
  bg: '#f1fdfe',
  line: 'rgba(13, 47, 94, 0.14)',
  accent: '#0d6b75',
  white: '#ffffff',
  bubble: '#f2f4f7',
};

const SCREEN_NAME: Record<string, string> = {
  '/': 'getting started',
  '/rates': 'rate estimates',
  '/meds': 'your medications',
  '/providers': 'your doctors',
  '/health': 'the health questions',
  '/results': 'your results',
};

function explainerText(id: string): string {
  const e = EXPLAINERS[id];
  if (!e) return '';
  return [e.eyebrow, ...e.cards.map((c) => `${c.heading}: ${c.body}`), e.callout ?? ''].filter(Boolean).join('\n');
}

function pageContextFor(path: string): string {
  const base = `The person is on the Medicare Supplement (Medigap) screen about ${SCREEN_NAME[path] ?? 'Medigap'}.`;
  if (path === '/') return `${base}\n${explainerText('supp.prompt')}`;
  if (path === '/health') return `${base}\n${explainerText('supp.health')}`;
  if (path === '/rates' || path === '/results') {
    return `${base}\nRates shown are estimates from public filings, not quotes. Final rates and acceptance come from the insurer's underwriting.`;
  }
  return base;
}

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING =
  "Hi, I'm Sarah, Rob's AI assistant. I can explain how Medicare Supplement plans work — open enrollment, plan letters like G and N, or why insurers ask health questions. What's on your mind?";

export function SarahWidget() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: GREETING }]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, open]);

  // Leave room at the bottom of the page so the corner button never sits on
  // top of the last field or the Continue button when scrolled to the end.
  const hidden = HIDDEN_ON.has(pathname);
  useEffect(() => {
    if (hidden) return;
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '84px';
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, [hidden]);

  if (hidden) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next);
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(SARAH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: 'supp', pageContext: pageContextFor(pathname), messages: next.slice(1) }),
      });
      const data = (await r.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (!r.ok || !data.reply) throw new Error(data.error || 'Sarah is unavailable right now.');
      setMsgs((m) => [...m, { role: 'assistant', content: data.reply as string }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sarah is unavailable right now.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Sarah, AI assistant"
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 18px 8px 8px',
          border: 'none',
          borderRadius: 999,
          background: T.navy,
          color: T.white,
          fontFamily: "'DM Sans', sans-serif",
          cursor: 'pointer',
          boxShadow: '0 10px 30px rgba(13,47,94,0.28)',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 36, height: 36, borderRadius: '50%', background: T.seafoam, color: T.navy, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
        >
          S
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Questions? Ask Sarah</span>
          <span style={{ fontSize: 12, color: '#cfe0f2' }}>AI assistant</span>
        </span>
      </button>
    );
  }

  const panelStyle: React.CSSProperties = narrow
    ? { left: 0, right: 0, bottom: 0, height: '82vh', borderRadius: '18px 18px 0 0' }
    : { right: 16, bottom: 16, width: 400, height: 'min(640px, calc(100vh - 32px))', borderRadius: 16 };

  return (
    <div
      role="dialog"
      aria-label="Sarah, AI assistant"
      style={{
        position: 'fixed',
        zIndex: 50,
        background: T.white,
        boxShadow: '0 -8px 40px rgba(13,47,94,0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'DM Sans', sans-serif",
        ...panelStyle,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            aria-hidden="true"
            style={{ width: 38, height: 38, borderRadius: '50%', background: T.navy, border: `3px solid ${T.seafoam}`, boxSizing: 'border-box', color: T.white, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
          >
            S
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.ink }}>Sarah</div>
            <div style={{ fontSize: 13, color: T.ink2 }}>AI assistant for GenerationHealth</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Sarah"
          style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', color: T.ink2, fontSize: 24, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: '10px 14px', background: T.bg, fontSize: 14, color: T.ink2, lineHeight: 1.5 }}>
        Sarah explains how Medigap works. She can&rsquo;t quote rates, review health answers, or say whether an insurer will accept you &mdash; Rob does that, for free. Please don&rsquo;t share your Medicare number, Social Security number, or health details here.
      </div>

      <div ref={listRef} aria-live="polite" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, color: T.accent, background: T.bg, border: `1px solid ${T.line}`, borderRadius: 999, padding: '4px 10px' }}>
          Looking at: {SCREEN_NAME[pathname] ?? 'Medigap'}
        </div>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? T.navy : T.bubble,
              color: m.role === 'user' ? T.white : T.ink,
              borderRadius: m.role === 'user' ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
              padding: '10px 12px',
              fontSize: 17,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content}
          </div>
        ))}
        {busy && <div style={{ alignSelf: 'flex-start', fontSize: 15, color: T.ink2 }}>Sarah is typing&hellip;</div>}
        {error && <div role="alert" style={{ fontSize: 15, color: '#9b2a2a' }}>{error}</div>}
      </div>

      <form onSubmit={send} style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: `1px solid ${T.line}` }}>
        <label htmlFor="sarah-supp-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Message Sarah
        </label>
        <input
          id="sarah-supp-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={800}
          placeholder="Type your question…"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, width: '100%', minHeight: 48, boxSizing: 'border-box', border: `1.5px solid ${T.line}`, borderRadius: 12, padding: '0 14px', fontFamily: 'inherit', fontSize: 17, color: T.ink }}
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          style={{ minHeight: 48, padding: '0 18px', border: 'none', borderRadius: 12, background: T.navy, color: T.white, fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: busy || !draft.trim() ? 0.5 : 1 }}
        >
          Send
        </button>
      </form>

      <div style={{ display: 'flex', gap: 8, padding: '0 14px 14px' }}>
        <a
          href="tel:+18287613326"
          style={{ flex: 1, minHeight: 46, borderRadius: 12, background: T.accent, color: T.white, fontWeight: 700, fontSize: 16, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          Call Rob
        </a>
        <a
          href={`sms:+18287613326?body=${encodeURIComponent('Hi Rob, I was asking Sarah about Medicare Supplement plans and have a question.')}`}
          style={{ flex: 1, minHeight: 46, borderRadius: 12, border: `1.5px solid ${T.line}`, color: T.navy, fontWeight: 700, fontSize: 16, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          Text Rob
        </a>
      </div>
    </div>
  );
}
