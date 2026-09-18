/*!
 * Writes the TCPA consent capture into AgentBase's public.tcpa_consent_log.
 *
 * WHY DIRECT PostgREST RATHER THAN AgentBase's /api/consent-log
 *
 * That endpoint exists and is the right door for browser callers, but it
 * takes consent_ip and consent_user_agent from ITS OWN request headers
 * (see clientIp() there). Called server-to-server from this Vercel
 * function it would faithfully record the FUNCTION's IP and user-agent
 * as the consumer's — evidence that is not merely useless but wrong.
 * The bridge already holds the AgentBase service-role key and writes
 * leads and clients over PostgREST, so the consent row goes the same
 * way, carrying the IP and user-agent actually captured from the
 * consumer's browser.
 *
 * WHY TWO ROWS PER ENROLLMENT
 *
 * The established shape in that table is ONE ROW PER CHANNEL CONSENTED
 * TO — the voice agent writes a channel='voice' row and a channel='sms'
 * row per call. `channel` is CHECK-constrained to sms | voice | web, so
 * a single row cannot express a disclosure that covers both calls and
 * texts, and collapsing it to one would make `where channel = 'sms'`
 * silently miss this surface. The supplement disclosure covers
 * autodialed/prerecorded CALLS and TEXT MESSAGES, so it produces one of
 * each. (It also covers email, which is outside both the TCPA and the
 * channel enum, so no row is written for it.)
 *
 * NON-FATAL by contract, mirroring AgentBase's own recordConsent():
 * losing the consumer's supplement application because an audit-log
 * insert failed is a worse outcome than a missing log row that the
 * silent-failure watchdog will flag the next day. Failures are returned,
 * never thrown.
 */

import type { TcpaConsentRecord } from './tcpa-consent.js';

/** DB CHECK: consent_source in (web_form, sms_keyword, voice_agent, enrollment, manual) */
const CONSENT_SOURCE = 'enrollment';
/** DB CHECK: consent_method in (checkbox, sms_reply, verbal, electronic_signature) */
const CONSENT_METHOD = 'checkbox';

/**
 * Channel + what was consented to on it. consent_type values match the
 * vocabulary already in the table ('marketing_sms') so one query spans
 * every source.
 */
const CHANNELS: Array<{ channel: 'sms' | 'voice'; consentType: string }> = [
  { channel: 'voice', consentType: 'marketing_calls' },
  { channel: 'sms', consentType: 'marketing_sms' },
];

/** E.164 for US numbers, matching how AgentBase's single writer stores
 *  them. Anything that isn't a 10-digit (or 1+10) US number is stored as
 *  the caller gave it rather than being mangled into a wrong number. */
export function toE164(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits ? `+${digits}` : null;
}

export interface ConsentLogResult {
  ok: boolean;
  written: number;
  reason?: string;
}

export async function writeConsentLog(args: {
  base: string;
  headers: Record<string, string>;
  consent: TcpaConsentRecord;
  phone: string;
  leadId: number | null;
  clientId: number | null;
  submissionId: string;
}): Promise<ConsentLogResult> {
  const { base, headers, consent, leadId, clientId, submissionId } = args;

  const phone = toE164(args.phone);
  if (!phone) return { ok: false, written: 0, reason: 'invalid_phone' };

  const rows = CHANNELS.map(({ channel, consentType }) => ({
    phone,
    lead_id: leadId,
    client_id: clientId,
    channel,
    consent_type: consentType,
    consent_source: CONSENT_SOURCE,
    consent_method: CONSENT_METHOD,
    // VERBATIM, from the same constant the consumer's screen rendered.
    consent_text: consent.consent_text,
    consent_at: consent.consent_at ?? consent.captured_at,
    consent_ip: consent.consent_ip,
    consent_user_agent: consent.consent_user_agent,
    verdict: 'granted',
    metadata: {
      consent_version: consent.consent_version,
      consent_basis: consent.consent_basis,
      consent_source_surface: consent.consent_source,
      enrollment_id: submissionId,
    },
  }));

  try {
    const resp = await fetch(`${base}/rest/v1/tcpa_consent_log`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!resp.ok) {
      const text = await resp.text();
      return {
        ok: false,
        written: 0,
        reason: `tcpa_consent_log insert ${resp.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, written: rows.length };
  } catch (err) {
    return {
      ok: false,
      written: 0,
      reason: err instanceof Error ? err.message : 'unknown',
    };
  }
}
