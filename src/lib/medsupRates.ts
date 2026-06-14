// Client-side helpers for the rate projection widget.
//
// State derivation duplicates the prefix logic in api/rates.ts on purpose —
// the api/_lib helper pattern would import the server module client-side and
// pull @vercel/node types into the browser bundle. The list is small enough
// to keep in two places.

export type MedsupCarrier = {
  n: string;
  c: string;
  ra: string | null;
  M: Record<number, number>;
  F: Record<number, number>;
};

type SupportedState = 'NC' | 'TX' | 'GA';

const STATE_LABELS: Record<SupportedState, string> = {
  NC: 'North Carolina',
  TX: 'Texas',
  GA: 'Georgia',
};

export function stateForZip(zip: string): SupportedState {
  const n = parseInt(zip.slice(0, 3), 10);
  if (n >= 270 && n <= 289) return 'NC';
  if (n >= 750 && n <= 799) return 'TX';
  if (n === 733) return 'TX';
  if (n >= 300 && n <= 319) return 'GA';
  if (n >= 398 && n <= 399) return 'GA';
  return 'NC';
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state as SupportedState] ?? state;
}

interface RatesResponse {
  ok: boolean;
  state?: string;
  carriers?: MedsupCarrier[];
  error?: string;
}

export async function fetchMedsupCarriers(
  state: string,
  signal?: AbortSignal,
): Promise<MedsupCarrier[]> {
  const resp = await fetch(`/api/medsup-rates?state=${encodeURIComponent(state)}`, {
    signal,
  });
  if (!resp.ok) {
    throw new Error(`Rate fetch failed (${resp.status})`);
  }
  const json = (await resp.json()) as RatesResponse;
  if (!json.ok) throw new Error(json.error ?? 'Rate fetch failed');
  return json.carriers ?? [];
}
