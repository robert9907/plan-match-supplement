import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
import { logPmPageview } from './lib/analytics';

// First-load funnel anchor. Fires before React mounts so the pageview
// lands even if the app crashes during init. Dev-origin exclusion inside
// the tracker keeps localhost and vercel.app previews silent.
logPmPageview();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
