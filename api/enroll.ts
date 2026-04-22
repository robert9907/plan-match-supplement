// POST /api/enroll — Plan Match Supplement submission endpoint.
//
// Mirrors the plan-match-prod pattern:
//   1. Validate the four authorization checks + signature + MBI format + DOB/age.
//   2. Insert into Supabase `supplement_applications` (service role).
//   3. Best-effort bridge to AgentBase CRM (clients upsert + leads insert).
//   4. Best-effort customer auto-ack SMS via AgentBase /api/send-sms.
//
// Returns { ok: true, submissionId } / { ok: false, errors: [...] }.
// Downstream failures (AgentBase, SMS) never surface as a 500 — the
// supplement_applications row is the authoritative record.

import type { VercelRequest, VercelResponse } from '@vercel/node';

// CMS Medicare Beneficiary Identifier — 11 chars, digits 1-9 in position 1,
// no S/L/O/I/B/Z in alpha positions (same regex as plan-match).
const MBI_REGEX =
  /^[1-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY0-9][0-9][AC-HJKMNP-RTVWXY][AC-HJKMNP-RTVWXY][0-9][0-9]$/;

// ─── Types ──────────────────────────────────────────────────────────────

interface MedicationInput {
  name: string;
  dose?: string | null;
  status?: string | null;
  statusText?: string | null;
}

interface EnrollPayload {
  // Contact + address
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county?: string | null;

  // Product + plan
  product?: 'supplement';
  carrier: string;
  planLetter: 'G' | 'N';

  // Scoring
  rateClassPredicted?: string | null;
  qualificationScore?: number | null;
  rateRangeLow?: number | null;
  rateRangeHigh?: number | null;

  // Medicare
  mbiNumber: string;
  securityPin: string;
  partAEffective?: string | null;
  partBEffective?: string | null;

  // Demographics
  dobMonth: string;
  dobDay: string;
  dobYear: string;
  age?: number | null;
  gender?: 'Male' | 'Female' | null;
  tobaccoUse?: 'Yes' | 'No' | null;
  heightInches?: number | null;
  weightLbs?: number | null;
  buildClass?: string | null;

  // Intent
  enrollmentPrompt?: string | null;

  // Auth + sig
  authChecks: [boolean, boolean, boolean, boolean];
  signedAt: string | null;

  // Full screening context
  context?: {
    medications?: MedicationInput[];
    healthAnswers?: Record<string, unknown>;
    clusterCounts?: Record<string, number>;
    comboFlags?: string[];
    escalationPattern?: string | null;
    providers?: Array<{ name: string }>;
  };
}

interface ValidationError {
  field: string;
  message: string;
}

// ─── Handler ────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res
      .status(405)
      .json({ ok: false, errors: [{ field: '_method', message: 'POST required' }] });
  }

  let payload: EnrollPayload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as EnrollPayload);
  } catch {
    return res.status(400).json({
      ok: false,
      errors: [{ field: '_body', message: 'Request body must be valid JSON.' }],
    });
  }

  const errors = validate(payload);
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  try {
    const submissionId = await persistToSupabase(payload);

    await bridgeToAgentBase(payload, submissionId).catch((err) => {
      console.error('[enroll] agentbase bridge failed:', err);
    });
    await notifyCustomerBySms(payload).catch((err) => {
      console.error('[enroll] customer sms failed:', err);
    });

    return res.status(200).json({ ok: true, submissionId });
  } catch (err) {
    console.error('[enroll] persistence failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ ok: false, errors: [{ field: '_server', message }] });
  }
}

// ─── Validation ─────────────────────────────────────────────────────────

function validate(p: Partial<EnrollPayload>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!Array.isArray(p.authChecks) || p.authChecks.length !== 4 || p.authChecks.some((c) => c !== true)) {
    errors.push({ field: 'authChecks', message: 'All four authorizations must be checked.' });
  }
  if (!p.signedAt) {
    errors.push({ field: 'signedAt', message: 'Electronic signature required.' });
  }

  if (!p.firstName?.trim() || !p.lastName?.trim()) {
    errors.push({ field: 'name', message: 'First and last name required.' });
  }

  if (!p.phone || p.phone.replace(/\D/g, '').length < 10) {
    errors.push({ field: 'phone', message: 'Valid mobile phone required.' });
  }

  if (!p.email || !/.+@.+\..+/.test(p.email)) {
    errors.push({ field: 'email', message: 'Valid email required.' });
  }

  const mbi = String(p.mbiNumber || '').replace(/[\s-]/g, '').toUpperCase();
  if (!MBI_REGEX.test(mbi)) {
    errors.push({ field: 'mbiNumber', message: 'Medicare ID does not match the CMS MBI format.' });
  }

  if (!p.securityPin || !/^\d{4}$/.test(p.securityPin)) {
    errors.push({ field: 'securityPin', message: '4-digit security PIN required.' });
  }

  if (!p.carrier?.trim() || (p.planLetter !== 'G' && p.planLetter !== 'N')) {
    errors.push({ field: 'plan', message: 'Carrier + Plan G/N required.' });
  }

  const ageErr = validateDobAndAge(p.dobYear, p.dobMonth, p.dobDay);
  if (ageErr) errors.push(ageErr);

  return errors;
}

function validateDobAndAge(
  year?: string,
  month?: string,
  day?: string,
): ValidationError | null {
  if (!year || !month || !day) return { field: 'dob', message: 'Date of birth required.' };
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return { field: 'dob', message: 'DOB must be numeric.' };
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { field: 'dob', message: 'DOB is not a real calendar date.' };
  }

  const now = new Date();
  let age = now.getUTCFullYear() - y;
  const mBefore = now.getUTCMonth() < m - 1;
  const mSame = now.getUTCMonth() === m - 1;
  const dBefore = now.getUTCDate() < d;
  if (mBefore || (mSame && dBefore)) age -= 1;
  if (age < 63) return { field: 'dob', message: 'Beneficiary must be at least 63 years old.' };
  if (age > 125) return { field: 'dob', message: 'DOB out of range.' };

  return null;
}

function pad2(s: string): string {
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return '';
  return String(n).padStart(2, '0');
}

// DOB → YYYY-MM-DD for downstream systems (AgentBase stores dob as a date).
function dobIso(p: EnrollPayload): string | null {
  const y = p.dobYear;
  const m = pad2(p.dobMonth);
  const d = pad2(p.dobDay);
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

// ─── Supabase insert (PostgREST, service role) ──────────────────────────

async function persistToSupabase(p: EnrollPayload): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');

  const cleanMbi = String(p.mbiNumber || '').replace(/[\s-]/g, '').toUpperCase();
  const digits = (p.phone || '').replace(/\D/g, '');

  const row = {
    first_name: p.firstName,
    last_name: p.lastName,
    phone: digits,
    email: p.email || null,
    address: p.address || null,
    city: p.city || null,
    state: p.state || null,
    zip: p.zip || null,
    county: p.county ?? null,
    product: p.product ?? 'supplement',
    carrier: p.carrier,
    plan_letter: p.planLetter,
    rate_class_predicted: p.rateClassPredicted ?? null,
    qualification_score: p.qualificationScore ?? null,
    rate_range_low: p.rateRangeLow ?? null,
    rate_range_high: p.rateRangeHigh ?? null,
    mbi_number: cleanMbi,
    security_pin: p.securityPin || null,
    part_a_effective: p.partAEffective ?? null,
    part_b_effective: p.partBEffective ?? null,
    dob_month: p.dobMonth || null,
    dob_day: p.dobDay || null,
    dob_year: p.dobYear || null,
    age: p.age ?? null,
    gender: p.gender ?? null,
    tobacco_use: p.tobaccoUse ?? null,
    height_inches: p.heightInches ?? null,
    weight_lbs: p.weightLbs ?? null,
    build_class: p.buildClass ?? null,
    enrollment_prompt: p.enrollmentPrompt ?? null,
    status: 'submitted',
    context: {
      medications: p.context?.medications ?? [],
      healthAnswers: p.context?.healthAnswers ?? {},
      clusterCounts: p.context?.clusterCounts ?? {},
      comboFlags: p.context?.comboFlags ?? [],
      escalationPattern: p.context?.escalationPattern ?? null,
      providers: p.context?.providers ?? [],
      authChecks: p.authChecks,
      signedAt: p.signedAt,
    },
  };

  const resp = await fetch(`${url.replace(/\/$/, '')}/rest/v1/supplement_applications`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase insert ${resp.status}: ${text.slice(0, 300)}`);
  }

  const body = (await resp.json()) as Array<{ id: string }>;
  const inserted = Array.isArray(body) ? body[0] : null;
  if (!inserted?.id) throw new Error('Supabase returned no id.');
  return inserted.id;
}

// ─── AgentBase CRM bridge ──────────────────────────────────────────────
//
// Same two-write pattern as plan-match-prod:
//   clients  — upsert keyed on last-10 digits of phone; PATCH drops null
//              fields so we never blank out data Rob enriched manually.
//   leads    — always INSERT; source='plan_match_supplement',
//              product='supplement', context carries the full screening
//              payload so the AgentBase PlanMatch tab can render inline.

async function bridgeToAgentBase(p: EnrollPayload, submissionId: string): Promise<void> {
  const url = process.env.AGENTBASE_SUPABASE_URL;
  const key = process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('[enroll] AGENTBASE_SUPABASE_* not set; skipping CRM bridge.');
    return;
  }

  const digits = (p.phone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    console.error('[enroll] agentbase bridge: phone has <10 digits, skipping');
    return;
  }
  const last10 = digits.slice(-10);

  const base = url.replace(/\/$/, '');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  const address = [p.address, p.city, p.state, p.zip]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ');

  const cleanMbi = String(p.mbiNumber || '').replace(/[\s-]/g, '').toUpperCase();
  const dob = dobIso(p);
  const planName = `Plan ${p.planLetter}`;

  // ─── clients · upsert on normalized phone digits ────────────────────
  try {
    const a = last10.slice(0, 3);
    const b = last10.slice(3, 6);
    const c = last10.slice(6);
    const pattern = `*${a}*${b}*${c}*`;
    const lookupUrl = `${base}/rest/v1/clients?phone=ilike.${encodeURIComponent(pattern)}&select=id,phone,lead_source&limit=20`;
    const lookup = await fetch(lookupUrl, { headers: { ...headers, Accept: 'application/json' } });
    const lookupText = await lookup.text();
    if (!lookup.ok) throw new Error(`clients lookup ${lookup.status}: ${lookupText.slice(0, 200)}`);
    const candidates = JSON.parse(lookupText) as Array<{
      id: string | number;
      phone: string | null;
      lead_source: string | null;
    }>;
    const existing = candidates.find(
      (row) => (row.phone ?? '').replace(/\D/g, '').slice(-10) === last10,
    );

    if (existing) {
      const existingLeadSource = (existing.lead_source || '').trim();
      const patch = dropNullish({
        first_name: p.firstName,
        last_name: p.lastName,
        email: p.email,
        dob,
        address,
        county: p.county,
        medicare_id: cleanMbi,
        carrier: p.carrier,
        plan_name: planName,
        lead_source: existingLeadSource ? undefined : 'Plan Match Supplement',
      });
      if (Object.keys(patch).length > 0) {
        const patchResp = await fetch(
          `${base}/rest/v1/clients?id=eq.${encodeURIComponent(String(existing.id))}`,
          {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify(patch),
          },
        );
        if (!patchResp.ok) {
          const text = await patchResp.text();
          throw new Error(`clients patch ${patchResp.status}: ${text.slice(0, 200)}`);
        }
      }
    } else {
      const insertBody = {
        first_name: p.firstName,
        last_name: p.lastName,
        phone: digits,
        email: p.email || null,
        dob,
        address: address || null,
        county: p.county ?? null,
        medicare_id: cleanMbi || null,
        carrier: p.carrier,
        plan_name: planName,
        lead_source: 'Plan Match Supplement',
      };
      const insertResp = await fetch(`${base}/rest/v1/clients`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(insertBody),
      });
      if (!insertResp.ok) {
        const text = await insertResp.text();
        throw new Error(`clients insert ${insertResp.status}: ${text.slice(0, 400)}`);
      }
    }
  } catch (err) {
    console.error('[enroll:clients] SYNC FAILED:', err instanceof Error ? err.message : err);
  }

  // ─── leads · always insert ──────────────────────────────────────────
  try {
    const medicationNames = (p.context?.medications ?? [])
      .map((m) => {
        if (!m?.name?.trim()) return null;
        const parts = [m.name.trim()];
        if (m.dose?.trim()) parts.push(m.dose.trim());
        if (m.statusText?.trim()) parts.push(m.statusText.trim());
        return parts.join(' · ');
      })
      .filter((s): s is string => !!s);

    const leadRow = {
      first_name: p.firstName,
      last_name: p.lastName,
      phone: digits,
      source: 'plan_match_supplement',
      product: 'supplement',
      medicare_id: cleanMbi || null,
      security_pin: p.securityPin || null,
      context: {
        carrier: p.carrier,
        plan_letter: p.planLetter,
        rate_class_predicted: p.rateClassPredicted ?? null,
        qualification_score: p.qualificationScore ?? null,
        rate_range_low: p.rateRangeLow ?? null,
        rate_range_high: p.rateRangeHigh ?? null,
        enrollment_prompt: p.enrollmentPrompt ?? null,
        age: p.age ?? null,
        gender: p.gender ?? null,
        tobacco_use: p.tobaccoUse ?? null,
        height_inches: p.heightInches ?? null,
        weight_lbs: p.weightLbs ?? null,
        build_class: p.buildClass ?? null,
        email: p.email || null,
        address: address || null,
        county: p.county ?? null,
        dob,
        part_a_effective: p.partAEffective ?? null,
        part_b_effective: p.partBEffective ?? null,
        enrollment_id: submissionId,
        medications: medicationNames,
        health_answers: p.context?.healthAnswers ?? {},
        cluster_counts: p.context?.clusterCounts ?? {},
        combo_flags: p.context?.comboFlags ?? [],
        escalation_pattern: p.context?.escalationPattern ?? null,
        providers: p.context?.providers ?? [],
      },
    };
    const leadResp = await fetch(`${base}/rest/v1/leads`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(leadRow),
    });
    if (!leadResp.ok) {
      const text = await leadResp.text();
      throw new Error(`leads insert ${leadResp.status}: ${text.slice(0, 200)}`);
    }
  } catch (err) {
    console.error('[enroll] agentbase leads insert failed:', err);
  }
}

function dropNullish<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

// ─── Customer auto-ack SMS (proxied through AgentBase /api/send-sms) ────
//
// Fires at submission time so the applicant gets a "received, reviewing"
// text within a couple seconds of tapping Submit. Proxied through
// AgentBase's /api/send-sms so the Messaging Service SID, opt-out check,
// and messages-table audit already wired there are reused. No Twilio
// creds need to live on this project. Set AGENTBASE_SMS_URL to the
// AgentBase deploy base URL (e.g. https://agentbase-crm.vercel.app) to
// enable; unset disables the send cleanly (preview deploys stay quiet).

async function notifyCustomerBySms(p: EnrollPayload): Promise<void> {
  const agentbaseUrl = process.env.AGENTBASE_SMS_URL;
  if (!agentbaseUrl) {
    console.log('[enroll:sms] AGENTBASE_SMS_URL not set; skipping customer ack.');
    return;
  }

  const digits = (p.phone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    console.log('[enroll:sms] skipped — phone has <10 digits');
    return;
  }
  const to = `+1${digits.slice(-10)}`;

  const firstName = (p.firstName || '').trim() || 'there';
  const body =
    `Hi ${firstName} — we received your application for ${p.carrier} Plan ${p.planLetter}. ` +
    `We're reviewing now and will be in touch within 10 minutes. ` +
    `— Generation Health, (828) 761-3326`;

  const base = agentbaseUrl.replace(/\/$/, '');
  const resp = await fetch(`${base}/api/send-sms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      body,
      message_type: 'supplement_submit_ack',
      source: 'plan_match_supplement_submit',
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`send-sms ${resp.status}: ${text.slice(0, 300)}`);
  }
  try {
    const data = JSON.parse(text) as { sid?: string; status?: string; message_id?: string | number };
    console.log('[enroll:sms] customer ack sent', {
      sid: data?.sid ?? null,
      status: data?.status ?? null,
      message_id: data?.message_id ?? null,
      phone_last4: digits.slice(-4),
    });
  } catch {
    console.log('[enroll:sms] customer ack sent (non-JSON response)');
  }
}
