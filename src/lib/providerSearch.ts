// Shared provider search client — calls the consumer Plan Match library
// API (https://planmatch.generationhealth.me/api/library/npi-search),
// the same canonical NPPES proxy the consumer and ACA apps use. POST
// with { query, state?, limit } → ranked NPI Registry hits.
//
// Deliberately mirrors drugSearch.ts: same MIN_SEARCH_CHARS, same
// debounce contract, same "return [] on any failure" posture. Provider
// capture is optional in this flow, so a search outage must degrade to
// free-text entry rather than blocking the step.
//
// CORS: the library endpoint validates Origin against an allowlist that
// includes *.generationhealth.me (plan-match/api/_lib/cors.ts), which
// covers this app's supplement.generationhealth.me deployment.
//
// WHY THIS EXISTS — Medicare Supplement has no provider networks, so
// nothing here checks coverage. The NPI still matters downstream: it is
// the key AgentBase matches on when linking a doctor to its providers
// directory (resolveProviderId in agentbase-crm/lib/planmatch-sync.js
// tries NPI first, then a normalized name). Sending a bare typed name
// meant every supplement provider either forked a duplicate directory
// row or matched the wrong clinician.

const ENDPOINT = 'https://planmatch.generationhealth.me/api/library/npi-search';

export const MIN_SEARCH_CHARS = 3;

export interface ProviderSearchResult {
  npi: string;
  enumeration_type?: string;
  first_name?: string;
  last_name?: string;
  credential?: string;
  specialty?: string;
  specialty_display?: string;
  practice_name?: string;
  practice_address_1?: string;
  practice_city?: string;
  practice_state?: string;
  practice_zip?: string;
  display_name?: string;
}

/** The server already composes display_name; fall back to assembling
 *  one so a shape change upstream degrades to something readable
 *  instead of a blank row. */
export function providerDisplayName(p: ProviderSearchResult): string {
  if (p.display_name) return p.display_name;
  const person = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  const withCred = p.credential ? `${person}, ${p.credential}` : person;
  return withCred || p.practice_name || 'Unknown provider';
}

/** Second line in the autocomplete: specialty + city/state. */
export function providerDisplayDetail(p: ProviderSearchResult): string {
  const where = [p.practice_city, p.practice_state].filter(Boolean).join(', ');
  return [p.specialty_display || p.specialty, where].filter(Boolean).join(' · ');
}

/** Street address for the file, when NPPES has one. */
export function providerAddress(p: ProviderSearchResult): string | null {
  const parts = [p.practice_address_1, p.practice_city, p.practice_state, p.practice_zip]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

export async function searchProviders(
  query: string,
  state?: string | null,
  signal?: AbortSignal,
  limit = 5,
): Promise<ProviderSearchResult[]> {
  const q = query.trim();
  if (q.length < MIN_SEARCH_CHARS) return [];
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: q,
        // Launch-state filter is a ranking hint on the server, not a
        // hard filter; sending it when we know the applicant's state
        // pulls local clinicians up. Omitted rather than sent blank.
        ...(state && state.trim() ? { state: state.trim().toUpperCase() } : {}),
        limit,
      }),
      signal,
    });
    if (!r.ok) return [];
    const data = (await r.json()) as { providers?: ProviderSearchResult[] };
    return (data.providers ?? []).filter((p) => p && p.npi);
  } catch {
    // Aborted, offline, or CORS-blocked. Provider capture is optional —
    // the caller falls back to free-text add.
    return [];
  }
}
