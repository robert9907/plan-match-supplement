import { Navigate, Route, Routes } from 'react-router-dom';
import { About } from './components/About';
import { Application } from './components/Application';
import { FlowProvider } from './context/FlowContext';
import { Handshake } from './components/Handshake';
import { HealthScreen } from './components/HealthScreen';
import { Meds } from './components/Meds';
import { Results } from './components/Results';

export default function App() {
  return (
    <FlowProvider>
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
