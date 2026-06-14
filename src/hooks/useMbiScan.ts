// useMbiScan — client for POST /api/scan-mbi (Claude Vision).
//
// Mirrors useLabelScan / useCardScan so MbiCardScan can bind the result
// directly. After the user taps the shutter in MbiCardScan we POST the
// captured JPEG here; on `ok` we auto-populate the four MBI form fields,
// on `fallback` the UI keeps the photo on screen and surfaces a
// "Couldn't read your card — enter manually" hint.

import { useCallback, useState } from 'react';

export interface ExtractedCard {
  /** 11-char MBI formatted with dashes (XAXX-XXX-XXXX), or null on failure. */
  mbi: string | null;
  /** Cardholder full name as printed, or null. */
  beneficiaryName: string | null;
  /** 2-digit month "01".."12" or null. */
  partAMonth: string | null;
  /** 4-digit year or null. */
  partAYear: string | null;
  partBMonth: string | null;
  partBYear: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface MbiScanResponse {
  ok: boolean;
  card: ExtractedCard | null;
  fallback: boolean;
  error?: string;
}

export interface UseMbiScan {
  loading: boolean;
  error: string | null;
  scan: (photoDataUrl: string, mimeType?: string) => Promise<MbiScanResponse>;
  reset: () => void;
}

export function useMbiScan(): UseMbiScan {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(
    async (photoDataUrl: string, mimeType: string = 'image/jpeg'): Promise<MbiScanResponse> => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch('/api/scan-mbi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: photoDataUrl, mime_type: mimeType }),
        });
        const body = (await resp.json().catch(() => ({}))) as Partial<MbiScanResponse> & {
          error?: string;
        };
        if (!resp.ok && resp.status !== 200) {
          setError(body?.error ?? `HTTP ${resp.status}`);
          return { ok: false, card: null, fallback: true, error: body?.error };
        }
        const ok = Boolean(body?.ok);
        const fallback = Boolean(body?.fallback);
        const card = (body?.card as ExtractedCard | undefined) ?? null;
        if (!ok && body?.error) setError(String(body.error));
        return { ok, card, fallback, error: body?.error };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Card scan failed';
        setError(message);
        return { ok: false, card: null, fallback: true, error: message };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { loading, error, scan, reset };
}
