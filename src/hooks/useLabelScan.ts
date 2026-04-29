// useLabelScan — client for POST /api/scan-label (Claude Vision).
//
// Exposes a single scan(dataUrl) async call that submits the JPEG,
// awaits the structured label, and normalizes the shape into something
// the Confirm screen can bind to directly. Keeps network plumbing and
// retry/fallback semantics out of the UI component.

import { useCallback, useState } from 'react';

export interface LabelScanResult {
  drugName: string | null;
  strength: string | null;
  directions: string | null;
  quantity: string | null;
  prescriber: string | null;
  prescriberNpi: string | null;
  pharmacy: string | null;
  refills: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface UseLabelScan {
  loading: boolean;
  error: string | null;
  scan: (photoDataUrl: string) => Promise<{
    ok: boolean;
    label: LabelScanResult | null;
    fallback: boolean;
  }>;
  reset: () => void;
}

export function useLabelScan(): UseLabelScan {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async (photoDataUrl: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/scan-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: photoDataUrl, mime_type: 'image/jpeg' }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok && resp.status !== 200) {
        setError(body?.error ?? `HTTP ${resp.status}`);
        return { ok: false, label: null, fallback: true };
      }
      const ok = Boolean(body?.ok);
      const fallback = Boolean(body?.fallback);
      const label = (body?.label as LabelScanResult | undefined) ?? null;
      if (!ok && body?.error) setError(String(body.error));
      return { ok, label, fallback };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Vision request failed';
      setError(message);
      return { ok: false, label: null, fallback: true };
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { loading, error, scan, reset };
}
