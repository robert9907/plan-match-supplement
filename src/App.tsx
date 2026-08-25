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

export default function App() {
  return (
    <FlowProvider>
      <ScrollToTop />
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
