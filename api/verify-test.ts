// TEMPORARY: one-time verification endpoint for the E2E test submission.
// Removed in a follow-up commit after verification completes.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const VERIFY_SECRET = 'e2e-2026-04-26-rs-verify-once';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  if ((req.query.k as string) !== VERIFY_SECRET) return res.status(404).end();

  const submissionId = (req.query.id as string) || '';
  const phoneLast10 = (req.query.phone as string) || '';
  if (!submissionId || !phoneLast10) {
    return res.status(400).json({ ok: false, error: 'id and phone required' });
  }

  const supabase = {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  };
  const agentbase = {
    url: process.env.AGENTBASE_SUPABASE_URL!,
    key: process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY!,
  };

  const fetchJson = async (url: string, key: string) => {
    const r = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const text = await r.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, body };
  };

  const redact = (row: Record<string, unknown> | null | undefined) => {
    if (!row) return row;
    const out: Record<string, unknown> = { ...row };
    for (const f of ['mbi_number', 'medicare_id', 'security_pin']) {
      if (typeof out[f] === 'string') {
        const s = out[f] as string;
        out[f] = s.length >= 4 ? `***${s.slice(-4)}` : '***';
      }
    }
    return out;
  };

  // 1. Supabase: supplement_applications row
  const supRow = await fetchJson(
    `${supabase.url.replace(/\/$/, '')}/rest/v1/supplement_applications?id=eq.${encodeURIComponent(submissionId)}&select=*`,
    supabase.key,
  );

  // 2. AgentBase: leads where context->>'enrollment_id' matches
  const leadsRow = await fetchJson(
    `${agentbase.url.replace(/\/$/, '')}/rest/v1/leads?context->>enrollment_id=eq.${encodeURIComponent(submissionId)}&select=*`,
    agentbase.key,
  );

  // 3. AgentBase: clients matched by last 10 phone digits via ilike pattern
  const a = phoneLast10.slice(0, 3);
  const b = phoneLast10.slice(3, 6);
  const c = phoneLast10.slice(6);
  const pattern = `*${a}*${b}*${c}*`;
  const clientsRow = await fetchJson(
    `${agentbase.url.replace(/\/$/, '')}/rest/v1/clients?phone=ilike.${encodeURIComponent(pattern)}&select=*&order=created_at.desc&limit=5`,
    agentbase.key,
  );

  const supBody = Array.isArray(supRow.body) ? supRow.body.map(redact) : supRow.body;
  const leadsBody = Array.isArray(leadsRow.body) ? leadsRow.body.map(redact) : leadsRow.body;
  const clientsBody = Array.isArray(clientsRow.body) ? clientsRow.body.map(redact) : clientsRow.body;

  return res.status(200).json({
    ok: true,
    submissionId,
    supplement_applications: { status: supRow.status, ok: supRow.ok, rows: supBody },
    agentbase_leads: { status: leadsRow.status, ok: leadsRow.ok, rows: leadsBody },
    agentbase_clients: { status: clientsRow.status, ok: clientsRow.ok, rows: clientsBody },
  });
}
