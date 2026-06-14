// POST /api/scan-mbi — Claude Vision OCR for a Medicare beneficiary card.
//
// Body: { image_base64: string, mime_type?: string }
// Response:
//   { ok: true,  card: { mbi, partAMonth, partAYear, partBMonth, partBYear,
//                        beneficiaryName, confidence: 'high'|'medium'|'low' } }
//   { ok: false, fallback: true, card: <partial-card-or-null>, error?: string }
//
// MbiCardScan.tsx posts a JPEG data URL here after the shutter tap and
// auto-populates the four MBI form fields with the response. When
// confidence is low, the MBI fails server-side validation, or Vision
// returns junk, the client surfaces "Couldn't read your card — enter
// manually" and the user types the values off the photo as before.
//
// Card layout reference (CMS-issued post-2018 cards):
//   Top stripe (red):       "MEDICARE" wordmark
//   Beneficiary name:       FIRST LAST  (uppercase, sometimes with middle initial)
//   Medicare number:        11 chars in XAXX-XXX-XXXX form, monospaced
//   "Entitled to" block:    HOSPITAL (PART A)  EFFECTIVE  MM-DD-YYYY
//                           MEDICAL  (PART B)  EFFECTIVE  MM-DD-YYYY
// Some cards show only month/year on the effective lines (no day) — the
// MM/YYYY-only path is handled below.
//
// Keys: ANTHROPIC_API_KEY required. Configured in Vercel project env;
// never sent to the browser.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { MBI_REGEX, normalizeMbi } from './_lib/mbi';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

const VISION_MODEL = 'claude-sonnet-4-6';

// Anchor the prompt on the CMS format spec so Vision doesn't hand back
// driver's-license numbers from a photo of the wrong card. The visual
// example uses CMS's own canonical "1EG4-TE5-MK72" sample so the model
// has a concrete pattern to match against.
const PROMPT = `You are reading a U.S. Medicare beneficiary card. Return JSON with:

- mbi: the 11-character Medicare Beneficiary Identifier, formatted with dashes as displayed on the card (e.g. "1EG4-TE5-MK72"). Format rules: 11 characters in 4-3-4 groups, position 1 is a digit 1-9, positions 2/5/8/9 are uppercase letters (never S, L, O, I, B, or Z), positions 4/7/10/11 are digits, positions 3 and 6 are letters or digits. If the value you see does not match this pattern exactly, return null — do not invent characters to complete it.

- beneficiaryName: the cardholder's full name as printed (typically uppercase first and last, sometimes with a middle initial). Return exactly what's printed, in the printed case.

- partAMonth: the 2-digit month ("01"–"12") of the HOSPITAL (PART A) effective date. Return null if the line isn't visible or you can't read the month.

- partAYear: the 4-digit year of the HOSPITAL (PART A) effective date. Return null if you can't read it.

- partBMonth: the 2-digit month of the MEDICAL (PART B) effective date.

- partBYear: the 4-digit year of the MEDICAL (PART B) effective date.

Also include "confidence": "high" | "medium" | "low" reflecting how clearly the card is photographed. Use "low" if there's significant glare, motion blur, or if any field required guessing.

Use null for any field you can't read clearly. Do not infer missing characters. Return only the JSON object, no other text.`;

type SupportedMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

interface CardResult {
  mbi: string | null;
  beneficiaryName: string | null;
  partAMonth: string | null;
  partAYear: string | null;
  partBMonth: string | null;
  partBYear: string | null;
  confidence: 'high' | 'medium' | 'low';
}

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function normalizeMimeType(mime: string): SupportedMimeType {
  const lower = (mime || '').toLowerCase();
  if (lower === 'image/jpg') return 'image/jpeg';
  if (lower === 'image/jpeg' || lower === 'image/png' || lower === 'image/webp' || lower === 'image/gif') {
    return lower;
  }
  return 'image/jpeg';
}

function stripDataUrl(s: string): string {
  const idx = s.indexOf(',');
  if (s.startsWith('data:') && idx > 0) return s.slice(idx + 1);
  return s;
}

function nullable(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'none') return null;
  return s;
}

// Tolerant first-JSON-object extractor — mirrors scan-label so any
// `\`\`\`json` fencing or leading chatter from Vision still parses.
function parseJsonish(text: string): Record<string, unknown> | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

// Pad a month value to 2 digits; reject anything outside 01-12. Vision
// sometimes returns "1" instead of "01", and very occasionally an "M"
// from misreading; this rejects the latter.
function normalizeMonth(v: unknown): string | null {
  const s = nullable(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  return String(n).padStart(2, '0');
}

// Coerce to a 4-digit year in 1900..(current year + 5). Vision sometimes
// returns "26" for "2026" — we reject 2-digit forms rather than guess,
// since "26" could mean 1926 for older beneficiaries.
function normalizeYear(v: unknown): string | null {
  const s = nullable(v);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length !== 4) return null;
  const n = Number(digits);
  const max = new Date().getUTCFullYear() + 5;
  if (!Number.isFinite(n) || n < 1900 || n > max) return null;
  return digits;
}

// Server-side MBI gate. Normalizes (strip dashes + uppercase) and tests
// against the strict CMS character-position regex. Distinct from
// nullable() so the caller can downgrade confidence to 'low' instead of
// returning a half-valid MBI the form would reject anyway.
function normalizeAndValidateMbi(v: unknown): string | null {
  const raw = nullable(v);
  if (!raw) return null;
  const normalized = normalizeMbi(raw);
  if (normalized.length !== 11) return null;
  if (!MBI_REGEX.test(normalized)) return null;
  return normalized;
}

// Display-format the validated MBI as XAXX-XXX-XXXX for round-tripping
// back to the client. MbiCardScan's input formatter expects either form.
function formatMbiForDisplay(normalized: string): string {
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 7)}-${normalized.slice(7)}`;
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
  client = new Anthropic({ apiKey });
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const body = (req.body ?? {}) as { image_base64?: string; mime_type?: string };
  const raw = body.image_base64 ?? '';
  const imageBase64 = stripDataUrl(raw);
  const mimeType = normalizeMimeType(body.mime_type ?? 'image/jpeg');

  if (!imageBase64) {
    return res.status(400).json({ ok: false, error: 'image_base64 is required', fallback: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[scan-mbi] ANTHROPIC_API_KEY missing');
    return res.status(503).json({
      ok: false,
      error: 'Vision OCR not configured',
      fallback: true,
    });
  }

  try {
    const message = await anthropic().messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      system: PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            { type: 'text', text: 'Extract the fields per the schema.' },
          ],
        },
      ],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const parsed = parseJsonish(text);
    if (!parsed) {
      console.warn('[scan-mbi] vision returned non-JSON:', text.slice(0, 200));
      return res.status(200).json({
        ok: false,
        error: 'Could not read the card clearly',
        fallback: true,
        card: null,
        raw: text.slice(0, 500),
      });
    }

    const confRaw = String(parsed.confidence ?? '').toLowerCase();
    let confidence: CardResult['confidence'] =
      confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'medium';

    const mbiNormalized = normalizeAndValidateMbi(parsed.mbi);
    const partAMonth = normalizeMonth(parsed.partAMonth);
    const partAYear = normalizeYear(parsed.partAYear);
    const partBMonth = normalizeMonth(parsed.partBMonth);
    const partBYear = normalizeYear(parsed.partBYear);
    const beneficiaryName = nullable(parsed.beneficiaryName);

    // Anything we couldn't validate downgrades confidence — the model's
    // own "high" doesn't override a malformed MBI. The client uses this
    // to decide between auto-fill and "enter manually" fallback.
    if (!mbiNormalized) confidence = 'low';
    const datesComplete =
      Boolean(partAMonth) && Boolean(partAYear) && Boolean(partBMonth) && Boolean(partBYear);
    if (!datesComplete && confidence === 'high') confidence = 'medium';

    const card: CardResult = {
      mbi: mbiNormalized ? formatMbiForDisplay(mbiNormalized) : null,
      beneficiaryName,
      partAMonth,
      partAYear,
      partBMonth,
      partBYear,
      confidence,
    };

    // Fallback gate: client routes to manual entry when ok=false. We
    // still return the partial card so the form can pre-fill whatever
    // fields we *did* read confidently — no point making the user
    // re-type a valid Part A start when only the MBI failed.
    const unreadable = !mbiNormalized || confidence === 'low';

    return res.status(200).json({
      ok: !unreadable,
      card,
      ...(unreadable ? { fallback: true } : {}),
    });
  } catch (err) {
    console.error('[scan-mbi] vision error:', err);
    return res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Vision request failed',
      fallback: true,
      card: null,
    });
  }
}
