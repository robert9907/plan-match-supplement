// Road A — the structured medication + provider write into AgentBase.
//
// POST {AGENTBASE_API_URL}/api/planmatch-session
//   → agentbase-crm/app/api/planmatch-session/route.js
//
// The receiver writes client_medications + client_providers through
// upsertMedRow / resolveProviderId / upsertClientProviderLink: NPI-first
// directory matching, rxcui / tier / form preserved, and
// synced_from_planmatch_at stamped so the CRM shows the synced badge and
// the formulary panel has something to price against. Idempotent — it
// upserts on session_token and on (client_id, canonical name) /
// (client_id, provider_id), so a retry updates rather than duplicating.
//
// WHY THIS APP NEEDS IT
// This bridge already upserts a clients row and links client_providers,
// but it has never written client_medications at all — supplement
// medications only ever reached a client card if someone clicked
// "Promote to Client" on the lead in the CRM, and even then arrived
// without an rxcui because the browser dropped it before sending.
// Posting here closes both gaps: the meds land automatically on the
// card we just resolved, with their identifiers intact.
//
// This app resolves the client id itself during the clients upsert, so
// unlike the consumer plan-match bridge there is no phone lookup here —
// the caller passes the id straight through and the receiver takes its
// fast, unambiguous linkClient branch.

export interface AgentBaseMedication {
  name: string;
  rxcui?: string | null;
  dose?: string | null;
  frequency?: string | null;
  form?: string | null;
}

export interface AgentBaseProvider {
  name: string;
  npi?: string | null;
  specialty?: string | null;
  address?: string | null;
}

export interface AgentBaseSessionInput {
  /** Stable per-submission id — the receiver upserts on it. */
  sessionToken: string;
  /** Resolved AgentBase clients.id. */
  agentbaseClientId: number;
  client: {
    name?: string | null;
    phone?: string | null;
    dob?: string | null;
    zip?: string | null;
    county?: string | null;
    state?: string | null;
    plan_type?: string | null;
  };
  medications: AgentBaseMedication[];
  providers: AgentBaseProvider[];
  plansCompared?: string[];
  recommendation?: string | null;
  notes?: string[];
}

export type AgentBaseSessionResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; skipped: 'no_url' | 'no_secret' | 'nothing_to_sync' }
  | { ok: false; status: number; detail: string }
  | { ok: false; error: string };

function agentbaseBaseUrl(): string | null {
  // AGENTBASE_API_URL matches the name the broker-side Plan Match uses
  // for this exact route; AGENTBASE_SMS_URL is the same host and is
  // already configured here, so fall back to it rather than no-op'ing
  // on an env var nobody has set yet.
  const raw = process.env.AGENTBASE_API_URL || process.env.AGENTBASE_SMS_URL;
  return raw ? raw.replace(/\/$/, '') : null;
}

/**
 * Best-effort by contract: every failure resolves to a result object
 * rather than throwing, so the caller can await it inline without any
 * risk to the enrollment response. The lead and clients rows are
 * already written by the time this runs.
 */
export async function postAgentBaseSession(
  input: AgentBaseSessionInput,
): Promise<AgentBaseSessionResult> {
  const base = agentbaseBaseUrl();
  if (!base) return { ok: false, skipped: 'no_url' };

  const secret = process.env.PLANMATCH_WEBHOOK_SECRET;
  if (!secret) return { ok: false, skipped: 'no_secret' };

  const medications = (input.medications ?? []).filter((m) => m && m.name);
  const providers = (input.providers ?? []).filter((p) => p && p.name);
  if (medications.length === 0 && providers.length === 0) {
    return { ok: false, skipped: 'nothing_to_sync' };
  }

  const payload = {
    session: {
      session_token: input.sessionToken,
      mode: 'new_quote',
      started_at: new Date().toISOString(),
    },
    client: input.client ?? {},
    // Read at the TOP level by the receiver's linkClient() — it checks
    // payload.agentbase_client_id before payload.raw_payload.*.
    agentbase_client_id: input.agentbaseClientId,
    medications,
    providers,
    plans_compared: input.plansCompared ?? [],
    recommendation: input.recommendation ?? null,
    // Medigap has no CMS contract triple, so there is no recommended
    // plan object to hang on client_providers.last_known_plan_id.
    recommended_plan: null,
    compliance: {},
    notes: input.notes ?? [],
    source: 'plan-match-supplement',
    schema_version: 1,
  };

  try {
    const resp = await fetch(`${base}/api/planmatch-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail: detail.slice(0, 300) };
    }
    const body = await resp.json().catch(() => null);
    return { ok: true, status: resp.status, body };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
