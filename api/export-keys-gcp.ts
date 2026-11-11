// GET /api/export-keys-gcp?t=<one-time token> — ONE-TIME, remove right after use.
//
// Copies the two write-only Vercel secrets the Google Cloud Run copy needs
// (ENCRYPTION_KEY for Medicare numbers, SUPABASE_SERVICE_ROLE_KEY for
// plan-match-prod) into Google Secret Manager, server to server, so the
// values never pass through a laptop, shell or chat.
//
//   • Auth to this route: a one-time token; only its SHA-256 is in the code.
//   • Auth to Google: keyless. This production deployment's Vercel OIDC token
//     is exchanged at Google STS (provider "plan-match-supplement", which only
//     accepts this project's production environment) for a 5-minute token as
//     vercel-key-export@…, which can only add versions to the two secrets below.
//   • Values are never returned or logged — the response is key names with
//     saved / missing / failed.

import { createHash, timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOKEN_SHA256 = '1855d0b64fd85a5e0a8ee5476ad8eebbfb3ca16e1f1fea23aa97fb4a907af7dc';
const GCP_PROJECT = 'pivotal-surfer-513601-a1';
const WIF_AUDIENCE =
  '//iam.googleapis.com/projects/640236353459/locations/global/workloadIdentityPools/vercel/providers/plan-match-supplement';
const EXPORT_SA = `vercel-key-export@${GCP_PROJECT}.iam.gserviceaccount.com`;
const KEYS: Record<string, string> = {
  ENCRYPTION_KEY: 'pm-sup-encryption-key',
  SUPABASE_SERVICE_ROLE_KEY: 'pm-sup-supabase-service-role-key',
};

function tokenOk(t: unknown): boolean {
  if (typeof t !== 'string' || !t) return false;
  const a = Buffer.from(createHash('sha256').update(t).digest('hex'));
  const b = Buffer.from(TOKEN_SHA256);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function googleAccessToken(oidc: string): Promise<string> {
  const sts = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: WIF_AUDIENCE,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
      requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt',
      subjectToken: oidc,
    }),
  });
  if (!sts.ok) throw new Error(`Google STS refused the Vercel token (${sts.status})`);
  const federated = ((await sts.json()) as { access_token: string }).access_token;
  const imp = await fetch(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${EXPORT_SA}:generateAccessToken`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${federated}` },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '300s' }),
    },
  );
  if (!imp.ok) throw new Error(`Google refused impersonation (${imp.status})`);
  return ((await imp.json()) as { accessToken: string }).accessToken;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (!tokenOk(req.query.t)) { res.status(404).json({ error: 'Not found' }); return; }

  const oidc = (req.headers['x-vercel-oidc-token'] as string | undefined) || process.env.VERCEL_OIDC_TOKEN;
  if (!oidc) { res.status(502).json({ ok: false, error: 'no Vercel OIDC token on this deployment' }); return; }

  let token: string;
  try {
    token = await googleAccessToken(oidc);
  } catch (e) {
    res.status(502).json({ ok: false, error: (e as Error).message });
    return;
  }

  const results: Record<string, string> = {};
  for (const [envName, secret] of Object.entries(KEYS)) {
    const v = process.env[envName];
    if (!v) { results[envName] = 'missing'; continue; }
    const r = await fetch(
      `https://secretmanager.googleapis.com/v1/projects/${GCP_PROJECT}/secrets/${secret}:addVersion`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ payload: { data: Buffer.from(v, 'utf8').toString('base64') } }),
      },
    );
    results[envName] = r.ok ? 'saved' : `failed (${r.status})`;
  }
  const saved = Object.values(results).filter((s) => s === 'saved').length;
  res.status(200).json({ ok: saved === Object.keys(KEYS).length, saved, results });
}
