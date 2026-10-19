// POST /api/scan-label — Claude Vision OCR for pill-bottle labels.
//
// Body: { image_base64: string, mime_type?: string }
// Response:
//   { ok: true, label: { drugName, strength, directions, quantity,
//                        prescriber, prescriberNpi, pharmacy, refills,
//                        confidence: 'high' | 'medium' | 'low' } }
//   { ok: false, error: string, fallback: true }
//
// The consumer Meds/Camera flow posts a JPEG data URL here after the
// shutter tap; the shape matches the field names the Confirm screen
// expects so auto-fill is a straight copy. When confidence is low (or
// the model returns non-JSON / wrong shape), the client falls back to
// the manual drug-name search with the photo kept on screen as a
// reference.
//
// Keys: ANTHROPIC_API_KEY is required. Configured in Vercel project env;
// never sent to the browser.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';
import { applyCors } from './_lib/cors.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',
    },
  },
};

const VISION_MODEL = 'claude-sonnet-4-6';

const PROMPT = `Read this prescription label. Return JSON with:
- drugName: the medication name
- strength: dosage strength (e.g. 300mg)
- directions: sig/directions (e.g. Take 1 capsule by mouth 3 times daily)
- quantity: pill count
- prescriber: prescribing doctor's full name
- prescriberNpi: if visible
- pharmacy: pharmacy name
- pharmacyPhone: the pharmacy's phone number as printed
- pharmacyAddress: the pharmacy's street address as printed (street only)
- pharmacyCity: the pharmacy's city
- pharmacyState: the pharmacy's 2-letter state
- pharmacyZip: the pharmacy's 5-digit ZIP
- refills: number of refills remaining
- fillDate: the date the prescription was filled, as YYYY-MM-DD
- refillDate: a "refill by" / "next refill" date if one is printed, as YYYY-MM-DD (null if not printed — do not calculate one)
Also include "confidence": "high" | "medium" | "low" reflecting how legible the label is.
Use null for any field you can't read. Return only the JSON, no other text.`;

type SupportedMimeType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

// Scan 2 of 2: the barcode side of the bottle. Most pharmacy labels
// print the dispensed quantity directly under the barcode, so the front
// read can miss it — this pass reads only what sits around the barcode.
const BACK_PROMPT = `This photo shows the barcode side of a prescription bottle label. Return JSON with:
- quantity: the dispensed quantity printed near the barcode (usually directly below it, e.g. "QTY 90" or "90 TAB"), as a number only
- daysSupply: days' supply if printed (e.g. "DS 90" or "90 DAY SUPPLY"), as a number only
- ndc: the NDC number if printed
Also include "confidence": "high" | "medium" | "low" reflecting how legible the quantity is.
Use null for any field you can't read. Return only the JSON, no other text.`;

function posInt(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 && n < 10000 ? n : null;
}

function isoDate(v: unknown): string | null {
  const s = nullable(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

interface LabelResult {
  drugName: string | null;
  strength: string | null;
  directions: string | null;
  quantity: string | null;
  prescriber: string | null;
  prescriberNpi: string | null;
  pharmacy: string | null;
  pharmacyPhone: string | null;
  pharmacyAddress: string | null;
  pharmacyCity: string | null;
  pharmacyState: string | null;
  pharmacyZip: string | null;
  refills: string | null;
  fillDate: string | null;
  refillDate: string | null;
  confidence: 'high' | 'medium' | 'low';
}

function setCors(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
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

// Extract the first JSON object from a string, tolerant of code-fence
// wrappers and leading/trailing chatter. Returns null if nothing parses.
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

function normalizeLabel(raw: Record<string, unknown>): LabelResult {
  const confRaw = String(raw.confidence ?? '').toLowerCase();
  const confidence: LabelResult['confidence'] =
    confRaw === 'high' || confRaw === 'medium' || confRaw === 'low' ? confRaw : 'medium';
  return {
    drugName: nullable(raw.drugName),
    strength: nullable(raw.strength),
    directions: nullable(raw.directions),
    quantity: nullable(raw.quantity),
    prescriber: nullable(raw.prescriber),
    prescriberNpi: nullable(raw.prescriberNpi),
    pharmacy: nullable(raw.pharmacy),
    pharmacyPhone: nullable(raw.pharmacyPhone),
    pharmacyAddress: nullable(raw.pharmacyAddress),
    pharmacyCity: nullable(raw.pharmacyCity),
    pharmacyState: nullable(raw.pharmacyState)?.toUpperCase().slice(0, 2) ?? null,
    pharmacyZip: nullable(raw.pharmacyZip)?.replace(/\D/g, '').slice(0, 5) || null,
    refills: nullable(raw.refills),
    fillDate: isoDate(raw.fillDate),
    refillDate: isoDate(raw.refillDate),
    confidence,
  };
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
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });

  const body = (req.body ?? {}) as { image_base64?: string; mime_type?: string; side?: string };
  const side: 'front' | 'back' = body.side === 'back' ? 'back' : 'front';
  const raw = body.image_base64 ?? '';
  const imageBase64 = stripDataUrl(raw);
  const mimeType = normalizeMimeType(body.mime_type ?? 'image/jpeg');

  if (!imageBase64) {
    return res.status(400).json({ ok: false, error: 'image_base64 is required', fallback: true });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[scan-label] ANTHROPIC_API_KEY missing');
    return res.status(503).json({
      ok: false,
      error: 'Vision OCR not configured',
      fallback: true,
    });
  }

  try {
    const message = await anthropic().messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system: side === 'back' ? BACK_PROMPT : PROMPT,
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
      console.warn('[scan-label] vision returned non-JSON:', text.slice(0, 200));
      return res.status(200).json({
        ok: false,
        error: 'Could not read the label clearly',
        fallback: true,
        raw: text.slice(0, 500),
      });
    }

    if (side === 'back') {
      const confRaw = String(parsed.confidence ?? '').toLowerCase();
      const back = {
        quantity: posInt(parsed.quantity),
        daysSupply: posInt(parsed.daysSupply),
        ndc: nullable(parsed.ndc),
        confidence: confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium',
      };
      const ok = back.quantity != null && back.confidence !== 'low';
      return res.status(200).json({ ok, side, back, ...(ok ? {} : { fallback: true }) });
    }

    const label = normalizeLabel(parsed);

    // If the model says low confidence OR there's no drug name at all,
    // signal fallback so the client routes the user to manual typing.
    const unreadable = !label.drugName || label.confidence === 'low';

    return res.status(200).json({
      ok: !unreadable,
      label,
      ...(unreadable ? { fallback: true } : {}),
    });
  } catch (err) {
    console.error('[scan-label] vision error:', err);
    return res.status(200).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Vision request failed',
      fallback: true,
    });
  }
}
