// POST /api/enroll — Plan Match Supplement submission endpoint.
//
// Mirrors the plan-match-prod pattern:
//   1. Validate the four authorization checks + signature + MBI format + DOB/age.
//   2. Insert into Supabase `supplement_applications` (service role).
//   3. Bridge to AgentBase CRM (clients upsert + leads insert). Bridge is
//      hard-fail: env-var missing OR leads insert failure returns 502.
//      Consumer plan-match ate 51 days of silent failures because this
//      was best-effort; we won't repeat it. supplement_applications
//      remains the authoritative record, so no data is lost on 502.
//   4. Best-effort customer auto-ack SMS via AgentBase /api/send-sms.
//
// Returns { ok: true, submissionId } / { ok: false, errors: [...] }.
// Only SMS failures are swallowed — CRM bridge is fatal.

import type { VercelRequest, VercelResponse } from '@vercel/node';
// NOTE: .js extension is required. `"type": "module"` in package.json puts
// the compiled function into Node ESM mode; strict ESM resolution rejects
// extensionless relative imports at runtime (ERR_MODULE_NOT_FOUND) even
// though tsc `moduleResolution: "bundler"` accepts them at compile time.
import { applyCors } from './_lib/cors.js';
import { encrypt, hashPin, maskMbi } from './_lib/crypto.js';

// CMS Medicare Beneficiary Identifier — 11 chars, digits 1-9 in position 1,
// no S/L/O/I/B/Z in alpha positions (same regex as plan-match).
// Letter class [AC-HJKMNP-RT-Y] = A,C,D,E,F,G,H,J,K,M,N,P,Q,R,T,U,V,W,X,Y
// (20 letters; excludes B,I,L,O,S,Z exactly per CMS spec — earlier
// [AC-HJKMNP-RTVWXY] erroneously also excluded U).
const MBI_REGEX =
  /^[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9][0-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y][0-9][0-9]$/;

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

  // Enrollment period + SEP bundle. Optional — supplement enrollments
  // typically happen inside a Guaranteed Issue window rather than a
  // CMS SEP, but Rob's CRM still tracks the period + reason for audit.
  enrollmentPeriod?: string | null;
  sepReasonCode?: string | null;
  sepReasonLabel?: string | null;
  sepEffectiveDate?: string | null;
  enrollmentReason?: string | null;

  // Medicaid eligibility flag — mirrored to clients.medicaid_eligible
  // (mig 043). Real boolean.
  medicaidEligible?: boolean | null;

  // Auth + sig
  // 5-tuple as of W2 Fix 4. Index 4 is the TCPA prior-express-written-
  // consent block (split out of the prior composite #3 per FCC One-to-One
  // Consent rule eff. 2025-01-27). Older clients may still submit a
  // 4-tuple — see validateBody for the back-compat path.
  authChecks: [boolean, boolean, boolean, boolean] | [boolean, boolean, boolean, boolean, boolean];
  /** ISO timestamp captured client-side at the moment authChecks[4]
   *  flipped true. Burden-of-proof evidence under TCPA 47 USC 227 +
   *  47 CFR 64.1200(f)(9). Optional so legacy clients can still submit. */
  tcpaConsentAt?: string | null;
  signedAt: string | null;

  // Full screening context
  context?: {
    medications?: MedicationInput[];
    healthAnswers?: Record<string, unknown>;
    clusterCounts?: Record<string, number>;
    comboFlags?: string[];
    escalationPattern?: string | null;
    providers?: Array<{
      name: string;
      npi?: string;
      specialty?: string;
      affiliation?: string;
    }>;
  };
}

interface ValidationError {
  field: string;
  message: string;
}

// ─── Handler ────────────────────────────────────────────────────────────

// Best-effort downstream calls (AgentBase CRM bridge, customer ack SMS) must
// not consume the whole Vercel timeout budget. If either hangs, the function
// runs to its wall-clock limit and Vercel returns an HTML 500/504 that the
// client can't decode — surfacing as "Unexpected server response (500)."
const BEST_EFFORT_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Wrap the entire handler so no crash path can escape as a non-JSON 500.
  // The prior structure had a try/catch around persistToSupabase only —
  // anything that threw before that (or an unhandled rejection escaping
  // one of the best-effort awaits) would fall through to Vercel's default
  // HTML error page, which the client cannot JSON-parse.
  try {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
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

    let submissionId: string;
    try {
      submissionId = await persistToSupabase(payload);
    } catch (err) {
      console.error('[enroll] persistence failed:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return res.status(500).json({ ok: false, errors: [{ field: '_server', message }] });
    }

    // AgentBase bridge is hard-fail: env misconfig or leads insert
    // failure returns 502 so the customer's UI shows a real failure
    // state instead of pretending success. supplement_applications
    // remains the authoritative record (persisted above) so no data
    // is lost. Mirrors consumer plan-match/api/enroll.ts after the
    // 51-day silent-failure incident that motivated this change.
    try {
      await withTimeout(
        bridgeToAgentBase(payload, submissionId),
        BEST_EFFORT_TIMEOUT_MS,
        'agentbase-bridge',
      );
    } catch (err) {
      console.error('[enroll] agentbase bridge failed:', err);
      const message = err instanceof Error ? err.message : 'AgentBase bridge failed';
      return res.status(502).json({
        ok: false,
        submissionId,
        errors: [{ field: '_agentbase', message }],
      });
    }

    // SMS remains best-effort — a delayed customer ack is annoying, not
    // catastrophic, and the failure mode is Twilio-side (their outages
    // don't warrant our 502).
    await withTimeout(notifyCustomerBySms(payload), BEST_EFFORT_TIMEOUT_MS, 'customer-sms').catch((err) => {
      console.error('[enroll] customer sms failed:', err instanceof Error ? err.message : err);
    });

    return res.status(200).json({ ok: true, submissionId });
  } catch (err) {
    console.error('[enroll] unhandled handler error:', err);
    if (res.headersSent) return;
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ ok: false, errors: [{ field: '_server', message }] });
  }
}

// ─── Validation ─────────────────────────────────────────────────────────

function validate(p: Partial<EnrollPayload>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (
    !Array.isArray(p.authChecks) ||
    (p.authChecks.length !== 4 && p.authChecks.length !== 5) ||
    p.authChecks.some((c) => c !== true)
  ) {
    errors.push({
      field: 'authChecks',
      message: 'All authorizations must be checked.',
    });
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
    // W3 Fix 3: encrypt MBI + hash security PIN at rest. Migration
    // 004_mbi_encryption.sql adds the new columns. The legacy mbi_number
    // + security_pin columns are left in place for one OEP cycle so a
    // backfill / rollback path stays open; new writes only populate the
    // encrypted forms. HIPAA §164.312(a)(2)(iv); NIST SP 800-63B
    // Appendix A.3.
    mbi_number: null,
    security_pin: null,
    encrypted_mbi: cleanMbi ? encrypt(cleanMbi) : null,
    mbi_last4: cleanMbi ? cleanMbi.slice(-4) : null,
    mbi_masked: cleanMbi ? maskMbi(cleanMbi) : null,
    pin_hash: p.securityPin ? hashPin(String(p.securityPin)) : null,
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

// AgentBase stores Part A/B effective dates as separate month + year
// columns where month is the full English name ("April") and year is
// a 4-digit string ("2026"). The supplement form carries MM/DD/YYYY
// strings (see formatDate in Application.tsx); we split them here so
// clients.part_a_month / part_a_year / part_b_month / part_b_year get
// populated exactly the way plan-match-prod writes them.
const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function splitEffectiveMdy(mdy: string | null | undefined): { month: string; year: string } {
  if (!mdy) return { month: '', year: '' };
  const m = /^(\d{2})\/\d{2}\/(\d{4})$/.exec(mdy);
  if (!m) return { month: '', year: '' };
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx > 11) return { month: '', year: '' };
  return { month: MONTH_NAMES_LONG[idx], year: m[2] };
}

// AgentBase clients.sex stores lowercase 'male' / 'female'. Payload's
// `gender` is 'Male'/'Female' (title-case); normalize and default to
// null for anything unrecognized so we never write junk into the column.
function normalizeSex(input: unknown): 'male' | 'female' | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'male' || s === 'm') return 'male';
  if (s === 'female' || s === 'f') return 'female';
  return null;
}

// AgentBase clients.tobacco_user is a real boolean. Payload's
// `tobaccoUse` is 'Yes'/'No'. Return null for unrecognized values.
function normalizeTobacco(input: unknown): boolean | null {
  if (typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    const s = input.trim().toLowerCase();
    if (s === 'yes' || s === 'true') return true;
    if (s === 'no' || s === 'false') return false;
  }
  return null;
}

// Body Mass Index — 703 * lbs / in² rounded to 0.1. Returns null when
// either input is missing or out-of-range (guards against 0 division
// and against absurd values that would signal a bad payload rather
// than a real body). Written to clients.bmi (mig 045).
function computeBmi(heightInches: unknown, weightLbs: unknown): number | null {
  const h = typeof heightInches === 'number' ? heightInches : NaN;
  const w = typeof weightLbs === 'number' ? weightLbs : NaN;
  if (!Number.isFinite(h) || !Number.isFinite(w)) return null;
  if (h < 36 || h > 96) return null; // 3ft–8ft plausibility band
  if (w < 50 || w > 700) return null;
  const bmi = (703 * w) / (h * h);
  return Math.round(bmi * 10) / 10;
}

async function bridgeToAgentBase(p: EnrollPayload, submissionId: string): Promise<void> {
  const url = process.env.AGENTBASE_SUPABASE_URL;
  const key = process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Fail loud. This used to console.log + return, which is the exact
    // silent-failure mode consumer plan-match ate for 51 days when its
    // Vercel project had empty AGENTBASE_SUPABASE_* env vars. The
    // handler catches this and returns 502 so a misconfigured deploy
    // surfaces on the first submission instead of the first audit.
    throw new Error(
      'AGENTBASE_SUPABASE_URL or AGENTBASE_SUPABASE_SERVICE_ROLE_KEY is not configured in this environment',
    );
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
  const partA = splitEffectiveMdy(p.partAEffective);
  const partB = splitEffectiveMdy(p.partBEffective);

  // ─── clients · upsert on normalized phone digits ────────────────────
  // clientId is hoisted so the providers / client_providers block below
  // (after the leads INSERT) can link to it. Stays null on clients-
  // upsert failure — provider write then no-ops rather than orphaning.
  //
  // Full-field capture: every clients column with a matching payload
  // field is written here. Previously only ~9 columns were written;
  // sex / height_inches / weight_lbs / tobacco_user / medicaid_eligible /
  // enrollment_period / sep_* / enrollment_reason were all missing and
  // Rob had to hand-fill them post-enrollment.
  //
  // Soft-delete filter added — memory feedback_soft_delete_lookups:
  // without deleted_at=is.null the lookup re-anchors onto tombstoned
  // clients, silently PATCHing ghost rows Rob thought were removed.
  let clientId: number | null = null;
  try {
    const a = last10.slice(0, 3);
    const b = last10.slice(3, 6);
    const c = last10.slice(6);
    const pattern = `*${a}*${b}*${c}*`;
    const lookupUrl =
      `${base}/rest/v1/clients?phone=ilike.${encodeURIComponent(pattern)}` +
      `&deleted_at=is.null&select=id,phone,lead_source&limit=20`;
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

    // Common column map — used for both PATCH (dropNullish) and INSERT.
    const clientColumns: Record<string, unknown> = {
      first_name: p.firstName,
      last_name: p.lastName,
      phone: digits,
      email: p.email || null,
      dob,
      address: p.address || null,
      city: p.city || null,
      state: p.state || null,
      zip: p.zip || null,
      county: p.county ?? null,
      medicare_id: cleanMbi || null,
      carrier: p.carrier,
      plan_name: planName,
      part_a_month: partA.month || null,
      part_a_year: partA.year || null,
      part_b_month: partB.month || null,
      part_b_year: partB.year || null,
      sex: normalizeSex(p.gender),
      height_inches: typeof p.heightInches === 'number' ? p.heightInches : null,
      weight_lbs: typeof p.weightLbs === 'number' ? p.weightLbs : null,
      bmi: computeBmi(p.heightInches, p.weightLbs),
      tobacco_user: normalizeTobacco(p.tobaccoUse),
      medicaid_eligible:
        typeof p.medicaidEligible === 'boolean' ? p.medicaidEligible : null,
      enrollment_reason: p.enrollmentReason ?? null,
      enrollment_period: p.enrollmentPeriod ?? null,
      sep_reason_code:
        p.enrollmentPeriod === 'SEP' ? (p.sepReasonCode ?? null) : null,
      sep_effective_date: p.sepEffectiveDate ?? null,
    };

    if (existing) {
      clientId = Number(existing.id);
      const existingLeadSource = (existing.lead_source || '').trim();
      const patch = dropNullish({
        ...clientColumns,
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
      // Tombstone guard — refuse to re-anchor onto a soft-deleted row.
      const tombResp = await fetch(
        `${base}/rest/v1/clients?phone=ilike.${encodeURIComponent(pattern)}` +
          `&deleted_at=not.is.null&select=id&limit=1`,
        { headers: { ...headers, Accept: 'application/json' } },
      );
      if (tombResp.ok) {
        const tombs = (await tombResp.json()) as Array<{ id?: string | number }>;
        if (tombs.length > 0) {
          console.warn(
            '[enroll:clients] tombstoned client for this phone; skipping upsert',
            { tombstone_id: tombs[0]?.id ?? null, phone_last10: last10 },
          );
        }
      }
      if (clientId == null) {
        const insertBody = {
          ...clientColumns,
          lead_source: 'Plan Match Supplement',
        };
        const insertResp = await fetch(`${base}/rest/v1/clients`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify(insertBody),
        });
        if (!insertResp.ok) {
          const text = await insertResp.text();
          throw new Error(`clients insert ${insertResp.status}: ${text.slice(0, 400)}`);
        }
        const insertedRows = (await insertResp.json()) as Array<{ id?: number | string }>;
        const newId = Array.isArray(insertedRows) ? insertedRows[0]?.id ?? null : null;
        if (newId != null) clientId = Number(newId);
      }
    }
  } catch (err) {
    console.error('[enroll:clients] SYNC FAILED:', err instanceof Error ? err.message : err);
  }

  // ─── leads · always insert ──────────────────────────────────────────
  try {
    // Send full medication objects so AgentBase can access .name, .dose, etc.
    // Previous code flattened these to strings which broke CRM rendering.
    const medicationObjects = (p.context?.medications ?? [])
      .filter((m) => m?.name?.trim())
      .map((m) => ({
        name: m.name.trim(),
        dose: m.dose?.trim() || null,
        status: m.status || null,
        statusText: m.statusText?.trim() || null,
      }));

    const providerObjects = (p.context?.providers ?? [])
      .filter((pr) => pr?.name?.trim())
      .map((pr) => ({
        name: pr.name.trim(),
        ...(pr.npi ? { npi: pr.npi } : {}),
      }));

    const leadRow = {
      first_name: p.firstName,
      last_name: p.lastName,
      phone: digits,
      email: p.email || null,
      county: p.county ?? null,
      age: p.age ?? null,
      source: 'plan_match_supplement',
      product: 'supplement',
      // W3 Fix 3: leads.context on AgentBase carries the encrypted
      // bundle. The agent UI uses medicare_id_last4 + medicare_id_masked
      // for caller verification; full MBI is decrypt-on-demand at
      // carrier submission time. These live inside context (not top-
      // level) because the leads table doesn't have those columns —
      // an earlier version wrote them at top level and PostgREST
      // rejected the insert with PGRST204, which the outer catch
      // swallowed silently until the bridge hardening surfaced it.
      context: {
        medicare_id_encrypted: cleanMbi ? encrypt(cleanMbi) : null,
        medicare_id_last4: cleanMbi ? cleanMbi.slice(-4) : null,
        medicare_id_masked: cleanMbi ? maskMbi(cleanMbi) : null,
        security_pin_hash: p.securityPin ? hashPin(String(p.securityPin)) : null,
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
        medications: medicationObjects,
        health_answers: p.context?.healthAnswers ?? {},
        cluster_counts: p.context?.clusterCounts ?? {},
        combo_flags: p.context?.comboFlags ?? [],
        escalation_pattern: p.context?.escalationPattern ?? null,
        providers: providerObjects,
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
    // leads is the critical write — if it fails, propagate so the
    // handler returns 502. clients-upsert failure above is still
    // swallowed with a warning (a stale clients row is recoverable;
    // a missing lead means Rob never sees the submission at all).
    console.error('[enroll] agentbase leads insert failed:', err);
    throw err;
  }

  // ─── providers directory + client_providers link (fail-open) ────────
  // Runs only if we have a resolved clientId (from the clients upsert
  // above) and at least one provider on the payload. Each write is
  // guarded so a bad row doesn't abort the batch. Fail-open by design:
  // provider write failures do not affect the 200/502 response the
  // customer sees — the leads row has already landed, so Rob has the
  // ding and can re-link providers manually if this batch failed.
  if (clientId != null && Array.isArray(p.context?.providers)) {
    const syncedAt = new Date().toISOString();
    let dirInserted = 0;
    let dirDeduped = 0;
    let dirFailed = 0;
    let linkOk = 0;
    let linkFailed = 0;
    for (const pr of p.context.providers) {
      const provName = (pr?.name || '').trim();
      if (!provName) continue;
      const npi = (pr.npi ? String(pr.npi) : '').replace(/\D/g, '').slice(0, 10) || null;
      try {
        // Dedup by NPI when we have one. AgentBase providers.npi does
        // not have a unique constraint (id=336 + id=2470 hold the same
        // Kombiz Klein NPI), so we SELECT-then-INSERT.
        let providerId: number | null = null;
        if (npi) {
          const lookupResp = await fetch(
            `${base}/rest/v1/providers?npi=eq.${npi}&select=id&limit=1`,
            { headers: { ...headers, Accept: 'application/json' } },
          );
          if (lookupResp.ok) {
            const rows = (await lookupResp.json()) as Array<{ id?: number }>;
            if (rows[0]?.id != null) {
              providerId = Number(rows[0].id);
              dirDeduped += 1;
            }
          }
        }
        if (providerId == null) {
          const insertResp = await fetch(`${base}/rest/v1/providers`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'return=representation' },
            body: JSON.stringify({
              name: provName,
              npi,
              specialty: pr.specialty || null,
              affiliation: pr.affiliation || null,
            }),
          });
          if (insertResp.ok) {
            const rows = (await insertResp.json()) as Array<{ id?: number }>;
            if (rows[0]?.id != null) {
              providerId = Number(rows[0].id);
              dirInserted += 1;
            }
          } else {
            const txt = await insertResp.text();
            console.warn(
              '[enroll:providers] insert failed:',
              insertResp.status,
              txt.slice(0, 200),
            );
            dirFailed += 1;
            continue;
          }
        }
        if (providerId == null) continue;

        // Link via client_providers. 409 means the link already exists
        // (idempotent) — count as success. PGRST204 on
        // synced_from_planmatch_at means the column isn't in the
        // schema cache yet — retry without the stamp.
        const linkResp = await fetch(`${base}/rest/v1/client_providers`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({
            client_id: clientId,
            provider_id: providerId,
            synced_from_planmatch_at: syncedAt,
          }),
        });
        if (linkResp.ok || linkResp.status === 409) {
          linkOk += 1;
        } else {
          const txt = await linkResp.text();
          if (linkResp.status === 400 && /synced_from_planmatch_at/.test(txt)) {
            const retry = await fetch(`${base}/rest/v1/client_providers`, {
              method: 'POST',
              headers: { ...headers, Prefer: 'return=minimal' },
              body: JSON.stringify({ client_id: clientId, provider_id: providerId }),
            });
            if (retry.ok || retry.status === 409) linkOk += 1;
            else linkFailed += 1;
          } else {
            console.warn(
              '[enroll:client_providers] link failed:',
              linkResp.status,
              txt.slice(0, 200),
            );
            linkFailed += 1;
          }
        }
      } catch (err) {
        console.warn(
          '[enroll:providers] row error:',
          err instanceof Error ? err.message : err,
        );
        dirFailed += 1;
      }
    }
    console.log('[enroll:providers] done', {
      client_id: clientId,
      dir: { inserted: dirInserted, deduped: dirDeduped, failed: dirFailed },
      links: { ok: linkOk, failed: linkFailed },
    });
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
