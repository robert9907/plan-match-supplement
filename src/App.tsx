import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { About } from './components/About';
import { Application } from './components/Application';
import { FlowProvider } from './context/FlowContext';
import { Handshake } from './components/Handshake';
import { HealthScreen } from './components/HealthScreen';
import { Meds } from './components/Meds';
import { Providers } from './components/Providers';
import { RateProjection } from './components/RateProjection';
import { Results } from './components/Results';
import { logPmImpression, logPmOpened, logPmStep } from './lib/analytics';

// Reset scroll on every route change. Inside the embed iframe the user
// otherwise lands at whatever scroll offset the previous screen left
// behind, which usually reads as "the new screen opened at the bottom."
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    if (typeof document !== 'undefined') {
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    }
  }, [pathname]);
  return null;
}

// Canonical step name per route. Aligned to Rob's server-side stage
// rollup taxonomy (2026-08-31):
//   started    welcome
//   profiled   zip, about, priorities, meds-intro, meds-list, providers,
//              compare, processing
//   results    results, plan-detail
//   action     pm_enroll_start, pm_contacted, web_contacted, pm_enrolled
// 'rates' and 'health' are supplement-specific and land untagged in the
// rollup until the mapping learns them.
const STEP_FOR_ROUTE: Record<string, string> = {
  '/about':     'about',       // profiled
  '/rates':     'rates',       // supplement-only; untagged in rollup
  '/meds':      'meds-list',   // profiled
  '/providers': 'providers',   // profiled
  '/health':    'health',      // supplement-only; untagged in rollup
  '/results':   'results',     // results
  '/apply':     'pm_enroll_start', // action
  '/submitted': 'pm_enrolled', // action
};

// All funnel events originate here rather than from individual screens,
// so the wiring survives per-screen refactors and every event shares
// one product/county context.
//
//   pm_opened + pm_impression: fire once per session / page view via
//     the dedup inside the tracker; safe to call from an effect that
//     runs twice under StrictMode.
//   pm_step: dedup per (session, step) inside the tracker, so
//     back-navigation to a visited step does not double-count.
function AnalyticsBeacon() {
  const { pathname } = useLocation();

  useEffect(() => {
    logPmOpened();
    logPmImpression('hero');
  }, []);

  useEffect(() => {
    const step = STEP_FOR_ROUTE[pathname];
    if (step) logPmStep(step);
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <FlowProvider>
      <ScrollToTop />
      <AnalyticsBeacon />
      <Routes>
        {/* Step 1 lives at the root. /about is kept only as a redirect
            (see vercel.json + the client-side fallback below) because
            the Medicare track's cross-sell card still links to it. */}
        <Route path="/" element={<About />} />
        <Route path="/about" element={<Navigate to="/" replace />} />
        <Route path="/rates" element={<RateProjection />} />
        <Route path="/meds" element={<Meds />} />
        <Route path="/providers" element={<Providers />} />
        <Route path="/health" element={<HealthScreen />} />
        <Route path="/results" element={<Results />} />
        <Route path="/apply" element={<Application />} />
        <Route path="/submitted" element={<Handshake />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </FlowProvider>
  );
}
