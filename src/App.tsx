import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { About } from './components/About';
import { Application } from './components/Application';
import { FlowProvider } from './context/FlowContext';
import { Handshake } from './components/Handshake';
import { HealthScreen } from './components/HealthScreen';
import { Meds } from './components/Meds';
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
        <Route path="/embed/about" element={<About />} />
        <Route path="/embed/meds" element={<Meds />} />
        <Route path="/embed/health" element={<HealthScreen />} />
        <Route path="/embed/results" element={<Results />} />
        <Route path="/embed/apply" element={<Application />} />
        <Route path="/embed/submitted" element={<Handshake />} />
        <Route path="/embed" element={<Navigate to="/embed/about" replace />} />
        <Route path="*" element={<Navigate to="/embed/about" replace />} />
      </Routes>
    </FlowProvider>
  );
}
