// funnelTracking.ts — 30-checkpoint funnel + every-click / every-entry
// capture for Plan Match (Medicare, ACA, Supplement). Rob 2026-11-10:
// "track every detail … the impression, opening, what did they click, what
// did they enter, and did they move onto the next stage — each Plan Match
// should have a 30 pt check system so we can figure out the bottleneck."
//
// Same file is copied into all three apps so the three products write the
// exact same event shapes into gh_analytics_events:
//
//   pm_cp     one row per checkpoint reached, once per session per checkpoint
//             meta: { cp: 1..30, cp_key, step, ...safe detail }
//   pm_click  one row per tap on anything clickable
//             meta: { label, el, step }            (label '[private]' in
//                                                  private zones)
//   pm_input  one row per field the shopper changed
//             meta: { field, kind, step, value | filled+len }
//
// Checkpoints 1 and 2 (Plan Match button seen / clicked on the WordPress
// page) are fired by the WPCode embed snippet, not by the app, so the
// numbering is the same everywhere.
//
// Privacy: this is an anonymous analytics table on a licensed broker's site.
// Names, contact info, birth dates, Medicare numbers, medications, doctors,
// health answers and Medicaid status are NEVER stored as values — only that
// the field was filled and how long the entry was. Anything inside an
// element marked data-pm-private is redacted the same way. ZIP is cut to
// its first 3 digits, age to a band, income to the nearest $1,000 —
// matching the redaction already used by pm_about_complete.

export type Product = 'medicare' | 'aca' | 'supplement';
type Send = (eventType: string, params: Record<string, unknown>) => unknown;

interface Config {
  product: Product;
  catalog: readonly string[];          // index 0 = checkpoint 1
  send: Send;
  isSuppressed?: () => boolean;       // dev / DNT exclusion from the host app
}

let cfg: Config | null = null;
let currentStep = 'start';
let installed = false;

export function initFunnelTracking(config: Config): void {
  cfg = config;
}

/** Tell the click/entry capture which screen the shopper is on. */
export function setFunnelStep(step: string): void {
  if (step) currentStep = step;
}

function sessionKey(): string {
  try {
    const m = document.cookie.match(/(?:^|; )gh_sid=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : 'nosid';
  } catch {
    return 'nosid';
  }
}

function suppressed(): boolean {
  if (typeof window === 'undefined' || !cfg) return true;
  try {
    return cfg.isSuppressed ? cfg.isSuppressed() : false;
  } catch {
    return false;
  }
}

/**
 * Checkpoint reached. Fires once per session per checkpoint. Unknown keys
 * are ignored (logged once to the console) so a typo can't create a
 * checkpoint 31.
 */
export function cp(key: string, detail: Record<string, unknown> = {}): void {
  if (!cfg || suppressed()) return;
  const idx = cfg.catalog.indexOf(key);
  if (idx < 0) {
    console.warn(`[funnel] unknown checkpoint "${key}"`);
    return;
  }
  const guard = `pm_cp:${sessionKey()}:${cfg.product}:${key}`;
  try {
    if (sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, '1');
  } catch {
    /* private mode — falls through to the in-memory guard */
  }
  if (memGuard.has(guard)) return;
  memGuard.add(guard);
  try {
    cfg.send('pm_cp', { cp: idx + 1, cp_key: key, step: currentStep, ...detail });
  } catch {
    /* never block the shopper on telemetry */
  }
}
const memGuard = new Set<string>();

// ─── Redaction helpers ────────────────────────────────────────────────────

const PRIVATE_FIELD =
  /name|e-?mail|phone|\btel\b|address|street|city|dob|birth|\bmonth\b|\bday\b|\byear\b|ssn|social|medicare (num|id)|mbi|\bpin\b|password|signature|\bsign\b|drug|\bmeds?\b|medication|\brx\b|pharm|provider|doctor|physician|npi|search|height|weight|condition|health|medicaid|diagnos/i;
const SAFE_FIELD =
  /zip|age|income|household|people|county|state|metal|tier|sort|filter|plan type|deductible|premium|budget|tobacco|smok|gender|sex|period|coverage|prompt|reason|priority|letter|plan [gn]\b/i;

export function redactText(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/\(?\d[\d\s().-]{6,}\d/g, '[number]')
    .slice(0, 60);
}

function ageBand(n: number): string {
  return n < 26 ? 'under-26' : n < 35 ? '26-34' : n < 45 ? '35-44' : n < 55 ? '45-54'
    : n < 65 ? '55-64' : n < 70 ? '65-69' : n < 75 ? '70-74' : n < 80 ? '75-79' : '80+';
}

function safeValue(field: string, raw: string): string | number | null {
  const v = raw.trim();
  if (!v) return null;
  if (/zip/i.test(field)) return v.replace(/\D/g, '').slice(0, 3) || null;
  if (/income|salary|earn/i.test(field)) {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? Math.round(n / 1000) * 1000 : null;
  }
  if (/\bage\b|ages?$/i.test(field)) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? ageBand(n) : null;
  }
  return redactText(v).slice(0, 40);
}

function inPrivateZone(el: Element | null): string | null {
  const z = el?.closest('[data-pm-private]');
  return z ? z.getAttribute('data-pm-private') || 'private' : null;
}

// ─── Click capture ────────────────────────────────────────────────────────

const CLICKABLE =
  'button,a,[role=button],[role=option],[role=tab],[role=switch],[role=checkbox],[role=radio],label,select,summary,[data-track],input[type=checkbox],input[type=radio],input[type=range]';

function findClickable(start: Element): Element | null {
  const hit = start.closest(CLICKABLE);
  if (hit) return hit;
  // React onClick on a <div> leaves no attribute — fall back to the nearest
  // ancestor drawn with a pointer cursor (cards, tiles, list rows).
  let el: Element | null = start;
  for (let i = 0; el && i < 5; i++, el = el.parentElement) {
    try {
      if (getComputedStyle(el).cursor === 'pointer') return el;
    } catch {
      return null;
    }
  }
  return null;
}

function labelFor(el: Element): string {
  const tracked = el.getAttribute('data-track');
  if (tracked) return tracked;
  const aria = el.getAttribute('aria-label');
  if (aria) return redactText(aria);
  if (el instanceof HTMLInputElement) return redactText(fieldName(el));
  return redactText((el as HTMLElement).innerText || el.textContent || '') || el.tagName.toLowerCase();
}

let lastClick = { label: '', at: 0 };

function onClick(ev: Event): void {
  if (!cfg || suppressed()) return;
  const target = ev.target as Element | null;
  if (!target || !(target instanceof Element)) return;
  // Elements tagged data-cp="<checkpoint key>" reach that checkpoint on tap.
  const cpEl = target.closest('[data-cp]');
  if (cpEl) cp(cpEl.getAttribute('data-cp') || '');
  const el = findClickable(target);
  if (!el) return;
  const zone = inPrivateZone(el);
  const label = zone ? '[private]' : labelFor(el);
  const now = Date.now();
  if (label === lastClick.label && now - lastClick.at < 400) return; // double-fire
  lastClick = { label, at: now };
  const meta: Record<string, unknown> = { label, el: el.tagName.toLowerCase(), step: currentStep };
  if (zone) meta.area = zone;
  const href = el instanceof HTMLAnchorElement ? el.getAttribute('href') || '' : '';
  if (href) meta.link = href.startsWith('tel:') ? 'tel' : href.startsWith('sms:') ? 'sms' : redactText(href.split('?')[0]);
  try { cfg.send('pm_click', meta); } catch { /* swallow */ }
}

// ─── Entry capture ────────────────────────────────────────────────────────

function fieldName(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const tracked = el.getAttribute('data-track');
  if (tracked) return tracked;
  const aria = el.getAttribute('aria-label');
  if (aria) return aria;
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent?.trim()) return lbl.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap?.textContent?.trim()) return wrap.textContent.trim();
  return el.getAttribute('name') || el.getAttribute('placeholder') || el.id || el.type || 'field';
}

function onChange(ev: Event): void {
  if (!cfg || suppressed()) return;
  const el = ev.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
  const field = redactText(fieldName(el)).slice(0, 50);
  const kind = el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLTextAreaElement ? 'textarea' : el.type;
  const meta: Record<string, unknown> = { field, kind, step: currentStep };
  const zone = inPrivateZone(el);
  const raw = el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
    ? (el.checked ? 'on' : 'off')
    : el.value ?? '';
  const isPrivate =
    !!zone ||
    ['email', 'tel', 'password', 'date'].includes(kind) ||
    PRIVATE_FIELD.test(field) ||
    !(SAFE_FIELD.test(field) || kind === 'range' || kind === 'checkbox' || kind === 'radio');
  if (zone) meta.area = zone;
  if (isPrivate) {
    meta.filled = String(raw).trim().length > 0;
    meta.len = String(raw).trim().length;
  } else {
    meta.value = safeValue(field, String(raw));
  }
  try { cfg.send('pm_input', meta); } catch { /* swallow */ }
}

/** Attach the document-level click + entry listeners once. */
export function installAutoCapture(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  // Capture phase so a handler that stops propagation can't hide the tap.
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
}
