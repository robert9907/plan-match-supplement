// analytics.ts — Plan Match Supplement browser tracker (writes to
// gh_analytics_events on plan-match-prod). Ported from
// robert9907/plan-match apps/web/src/lib/analytics.js so cross-subdomain
// visitors resolve to one visitor in stats. Mirrors robert9907/
// plan-match-aca src/lib/analytics.ts byte-for-byte apart from the
// product constant.
//
// Two things intentionally differ from the source:
//
//   1. product is a build-time constant here. On the main subdomain the
//      user picks Medicare / ACA / Supplement inside the flow; on
//      supplement.generationhealth.me the product is known at load — an
//      open here IS a Supplement open. Every event carries
//      product='supplement' in meta AND in a synthesized page_url query,
//      because the server extracts product from page_url via
//      substring(page_url from 'product=([a-zA-Z_-]+)').
//
//   2. pm_impression is new. Without it we can count opens but not open
//      RATE — no denominator, so a placement problem is indistinguishable
//      from a demand problem. Debounced per (session, path, placement)
//      via sessionStorage so it fires once per page view, not once per
//      IntersectionObserver hit or per StrictMode double-mount. The main
//      app has an open defect where opens appear to fire on re-render
//      (414 opens from 3 distinct visitors on 2026-07-12); this dedup
//      exists specifically to not reproduce that.
//
// pm_completed and the pm_*_complete family are deliberately NOT emitted
// from this app. Per Rob 2026-08-31: legacy, stopped firing 2026-08-22,
// currently reports 601 completions against 41 flow starts. Use pm_step
// with meta.step='results' to signal flow completion instead.

const PRODUCT = 'supplement';

// Hardcoded to plan-match-prod rather than reading VITE_SUPABASE_URL —
// a misconfigured env var pointing this app at a different Supabase
// project would silently misroute analytics to one where
// gh_analytics_events doesn't exist.
const ANALYTICS_URL = 'https://rpcbrkmvalvdmroqzpaq.supabase.co';

// Anon key must be valid for plan-match-prod. Reads whichever browser env
// name is configured; either works.
const ANALYTICS_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
  '';

if (!ANALYTICS_KEY && typeof window !== 'undefined') {
  console.error(
    '[analytics] VITE_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) missing — pm_* events will 401'
  );
}

const ENDPOINT = `${ANALYTICS_URL}/rest/v1/gh_analytics_events`;

// pageview / pm_step / pm_impression / pm_opened / pm_contacted / pm_enrolled
// are the recognised event types. pm_completed intentionally omitted (see
// header). Everything else starting 'pm_' passes through so the flow can
// add fine-grained events without touching this file.
const CORE_TYPES = new Set<string>([
  'pageview',
  'pm_step',
  'pm_impression',
  'pm_opened',
  'pm_contacted',
  'pm_enrolled',
]);
const PASSTHROUGH_PREFIX = 'pm_';

// Dev-traffic exclusion. Auto-suppress when running on localhost or a
// vercel.app preview host. gh_dev=1 cookie is a per-device opt-out for
// production visits from Rob's own devices.
function isDevOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const h = (window.location.hostname || '').toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
  if (h.endsWith('.vercel.app')) return true;
  if (typeof document !== 'undefined' && /(^|;\s*)gh_dev=1(;|$)/.test(document.cookie)) return true;
  return false;
}

// ─── ID helpers (must match the WPCode snippet on generationhealth.me
//     and the plan-match / plan-match-aca trackers byte-for-byte, or
//     cross-domain visitors split into multiple ids) ──────────────────────
function rid(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
}

function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

function cookieGet(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function cookieSet(name: string, value: string, days: number | null): void {
  if (typeof document === 'undefined') return;
  const expires = days == null ? '' : `;expires=${new Date(Date.now() + days * 86400000).toUTCString()}`;
  // Domain on the apex so gh_sid / gh_vid are visible to WP (generationhealth.me),
  // to the main plan-match app (planmatch.generationhealth.me), to aca
  // (aca.generationhealth.me), and to supplement (supplement.generationhealth.me).
  document.cookie = `${name}=${encodeURIComponent(value)}${expires};domain=.generationhealth.me;path=/;samesite=lax`;
}

function getSessionId(): string {
  let s = cookieGet('gh_sid');
  if (s) return s;
  s = rid();
  cookieSet('gh_sid', s, null);
  return s;
}

function getVisitorId(): string {
  let v = cookieGet('gh_vid');
  if (v) return v;
  if (typeof navigator !== 'undefined' && typeof screen !== 'undefined') {
    v = fnv(
      [
        navigator.userAgent || '',
        `${screen.width}x${screen.height}`,
        new Date().getTimezoneOffset(),
        navigator.language || '',
      ].join('|')
    );
  } else {
    v = rid();
  }
  cookieSet('gh_vid', v, 365);
  return v;
}

// Supplement has real react-router routes (/about, /rates, /meds, ...)
// but each event still needs product=supplement in the query so the
// server-side substring extractor can tag it. When a caller passes
// opts.step, page_url synthesizes to /embed/<step>?product=supplement
// so the funnel dashboard groups events by canonical step name rather
// than the raw route name.
function buildPageUrl(step: string, county?: string | null): string {
  const params = new URLSearchParams();
  params.set('product', PRODUCT);
  if (county) params.set('county', county);
  return `/embed/${step}?${params.toString()}`;
}

export interface EventOpts {
  /** Override the auto-synthesized page_url. Rarely needed. */
  pageUrl?: string;
  /** Canonical step name (drives page_url synthesis and meta.step). */
  step?: string;
  /** County if known. */
  county?: string | null;
}

// ─── Public API ───────────────────────────────────────────────────────────
export function logPlanMatchEvent(
  eventType: string,
  params: Record<string, unknown> = {},
  opts: EventOpts = {}
): void {
  if (typeof window === 'undefined') return;
  const nav = navigator as Navigator & { doNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  if (nav.doNotTrack === '1' || win.doNotTrack === '1') return;
  if (isDevOrigin()) return;
  if (!CORE_TYPES.has(eventType) && !eventType.startsWith(PASSTHROUGH_PREFIX)) {
    console.warn(`[analytics] unknown pm event: ${eventType}`);
    return;
  }

  // product tag is forced onto every event so a server-side count over
  // meta->>product answers "how many supplement events" correctly
  // regardless of whether the caller remembered to include it.
  const meta: Record<string, unknown> = { product: PRODUCT, ...params };

  // page_url: explicit override > synthesized from opts.step > actual location.
  const pageUrl =
    opts.pageUrl ||
    (opts.step ? buildPageUrl(opts.step, opts.county) : location.pathname + location.search);
  const pageSlug = pageUrl.split('?')[0].replace(/^\/|\/$/g, '') || 'home';

  const stepForDb =
    typeof params.step === 'string'
      ? params.step
      : typeof params.method === 'string'
        ? params.method
        : null;

  const body = {
    session_id: getSessionId(),
    visitor_id: getVisitorId(),
    event_type: eventType,
    page_url: pageUrl,
    page_slug: pageSlug,
    referrer: document.referrer || null,
    source: 'plan-match',
    plan_match_step: stepForDb,
    meta,
    device_type:
      (window.innerWidth || 0) <= 768 ? 'mobile' : (window.innerWidth || 0) <= 1024 ? 'tablet' : 'desktop',
  };

  try {
    fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: ANALYTICS_KEY,
        Authorization: 'Bearer ' + ANALYTICS_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }).catch(() => {
      /* swallow — never block the flow on telemetry */
    });
  } catch {
    /* swallow */
  }
}

// First-load pageview on the supplement subdomain. Fires once from
// main.tsx at module load, before React mounts. Anchors direct arrivals
// (AI answers, bookmarks) to the session.
export function logPmPageview(): void {
  logPlanMatchEvent('pageview');
}

// Semantic "opened Plan Match" — fires once per session. Session dedup
// via sessionStorage rather than a ref because refs reset on StrictMode
// remount and the source app's Welcome.tsx firedRef pattern is fragile.
// Rob's stated bug: 414 opens from 3 distinct visitors on 2026-07-12,
// caused by re-render re-fires; do not reproduce.
export function logPmOpened(step: string = 'welcome', county?: string | null): void {
  if (typeof window === 'undefined') return;
  if (isDevOrigin()) return;
  try {
    const key = `pm_opened:${getSessionId()}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* private-mode sessionStorage throws — fall through, fire once per mount */
  }
  logPlanMatchEvent('pm_opened', { step }, { step, county });
}

// Impression event. "The widget entered viewport." Fires once per PAGE
// VIEW (path + placement), not once per IntersectionObserver hit.
// Placement values follow the marketing taxonomy: hero (full-viewport
// on load), inline (in-article), footer (page bottom), sticky (sticky
// bar). Supplement is a full-page phone-shell so effectively always
// 'hero'.
export type PmPlacement = 'hero' | 'inline' | 'footer' | 'sticky';
export function logPmImpression(placement: PmPlacement = 'hero', county?: string | null): void {
  if (typeof window === 'undefined') return;
  if (isDevOrigin()) return;
  try {
    const key = `pm_imp:${getSessionId()}:${location.pathname}:${placement}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* private-mode */
  }
  logPlanMatchEvent('pm_impression', { placement }, { step: 'impression', county });
}

// Per-step funnel event. Dedupes per (session, step) via sessionStorage
// so back-navigation and StrictMode double-mounts don't double-count.
// Canonical step buckets (Rob 2026-08-31):
//   started    welcome
//   profiled   zip, about, priorities, meds-intro, meds-list, providers,
//              compare, processing
//   results    results, plan-detail
//   action     pm_enroll_start, pm_contacted, web_contacted, pm_enrolled
//   abandoned  pm_abandonment
// Anything else is passed through and lands untagged in the server-side
// stage rollup. Supplement adds 'rates' and 'health' (untagged today).
export function logPmStep(step: string, county?: string | null): void {
  if (typeof window === 'undefined' || !step) return;
  if (isDevOrigin()) return;
  try {
    const key = `gh_step:${getSessionId()}:${step}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* fall through */
  }
  logPlanMatchEvent('pm_step', { step }, { step, county });
}

// Contact / enroll wrappers — kept for parity with the source tracker's
// API surface. Flow completion should fire through logPmStep('results').
export function logPmContacted(method: string, county?: string | null): void {
  logPlanMatchEvent('pm_contacted', { method }, { step: 'contact', county });
}

export function logPmEnrolled(planName: string | null, county?: string | null): void {
  logPlanMatchEvent('pm_enrolled', { planName }, { step: 'enrolled', county });
}
