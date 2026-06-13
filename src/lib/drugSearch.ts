// Shared drug search client — calls the consumer Plan Match library API
// (https://planmatch.generationhealth.me/api/library/drug-search). The
// endpoint is a POST with { query, limit } and returns rows from pm_drugs
// ranked with formulary-coverable drugs boosted. CORS is `*` so direct
// browser calls work; no local proxy needed.

const ENDPOINT = 'https://planmatch.generationhealth.me/api/library/drug-search';

export const MIN_SEARCH_CHARS = 2;

export interface DrugSearchResult {
  rxcui: string;
  name: string;
  generic_name: string;
  brand_name: string;
  strength: string;
  dose_form: string;
  is_brand: boolean;
}

// Mirror the server's `displayName` ranking key so what the user picked
// is what got sorted to the top.
export function drugDisplayName(d: DrugSearchResult): string {
  return d.brand_name || d.generic_name || d.name;
}

export function drugDisplayDetail(d: DrugSearchResult): string {
  return [d.strength, d.dose_form].filter(Boolean).join(' · ');
}

export async function searchDrugs(
  query: string,
  signal?: AbortSignal,
  limit = 5,
): Promise<DrugSearchResult[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_CHARS) return [];
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, limit }),
    signal,
  });
  if (!r.ok) return [];
  const data = (await r.json()) as { drugs?: DrugSearchResult[] };
  return data.drugs ?? [];
}
