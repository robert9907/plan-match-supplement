import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useFlow } from '../context/FlowContext';
import { SUPPLEMENT_CHECKPOINTS } from '../lib/funnelCatalog';
import { cp, initFunnelTracking, installAutoCapture, setFunnelStep } from '../lib/funnelTracking';
import { isDevOrigin, logPlanMatchEvent } from '../lib/analytics';

initFunnelTracking({
  product: 'supplement',
  catalog: SUPPLEMENT_CHECKPOINTS,
  send: (type, params) => logPlanMatchEvent(type, params, { step: String(params.step ?? '') || undefined }),
  isSuppressed: isDevOrigin,
});

const ROUTE_STEP: Record<string, string> = {
  '/': 'about', '/about': 'about', '/rates': 'rates', '/meds': 'meds-list',
  '/providers': 'providers', '/health': 'health', '/results': 'results',
  '/apply': 'apply', '/submitted': 'submitted',
};

function ageBand(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 65 ? 'under-65' : n < 70 ? '65-69' : n < 75 ? '70-74' : n < 80 ? '75-79' : '80+';
}

/** Drives the 30-checkpoint Supplement funnel from route + flow state. */
export function useFunnelCheckpoints(): void {
  const f = useFlow();
  const { pathname } = useLocation();

  useEffect(() => {
    installAutoCapture();
    cp('app_loaded');
  }, []);

  useEffect(() => {
    setFunnelStep(ROUTE_STEP[pathname] ?? pathname);
    switch (pathname) {
      case '/': case '/about': cp('about_shown'); break;
      case '/rates': cp('rates_shown'); break;
      case '/meds': cp('meds_shown'); break;
      case '/providers': cp('providers_shown', { skipped_meds: f.meds.length === 0 }); break;
      case '/health': cp('health_shown', { skipped_providers: f.providers.length === 0 }); break;
      case '/results': cp('results_shown'); break;
      case '/apply': cp('apply_shown'); break;
      case '/submitted': cp('action_taken', { method: 'submitted' }); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => { if (f.prompt) cp('prompt_picked', { prompt: f.prompt }); }, [f.prompt]);
  useEffect(() => {
    if (f.dob.month && f.dob.day && f.dob.year.length === 4) cp('birth_date_entered', { age_band: ageBand(f.age) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.dob.month, f.dob.day, f.dob.year]);
  useEffect(() => { if (f.gender) cp('gender_picked'); }, [f.gender]);
  useEffect(() => { if (f.tobacco) cp('tobacco_picked'); }, [f.tobacco]);
  useEffect(() => { if (f.zip.length === 5) cp('zip_entered', { zip3: f.zip.slice(0, 3) }); }, [f.zip]);
  useEffect(() => { if (f.meds.length > 0) cp('med_added'); }, [f.meds.length]);
  useEffect(() => { if (f.providers.length > 0) cp('provider_added'); }, [f.providers.length]);
  useEffect(() => { if (Object.values(f.health ?? {}).some((v) => v != null)) cp('health_first_answer'); }, [f.health]);
  useEffect(() => { if (f.heightIn && f.weightLbs) cp('height_weight_entered'); }, [f.heightIn, f.weightLbs]);
  useEffect(() => {
    if (f.selectedCarrier) cp('plan_selected', { plan_letter: f.selectedPlan });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.selectedCarrier, f.selectedPlan]);
  const a = f.application;
  useEffect(() => { if (a.firstName || a.lastName) cp('details_started'); }, [a.firstName, a.lastName]);
  useEffect(() => { if (a.phone || a.email) cp('contact_filled'); }, [a.phone, a.email]);
  useEffect(() => { if (a.addressLine) cp('address_filled'); }, [a.addressLine]);
  useEffect(() => { if (a.authChecks.every(Boolean)) cp('authorizations_checked'); }, [a.authChecks]);
  useEffect(() => { if (a.signedAt) cp('signed'); }, [a.signedAt]);
}
