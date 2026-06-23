// Shared CORS allowlist for PII/PHI-handling endpoints.
//
// Previously every PII route set `Access-Control-Allow-Origin: *`
// which let any malicious origin fetch MBI / health-screen / DOB /
// scan payloads through a victim's browser session. This helper
// validates the Origin header against the brokerage's deployments
// and the WordPress embed host, and only echoes it back on match.
//
// Regulation: HIPAA Security Rule 45 CFR § 164.312(e)(1); OWASP A05.

import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOWED_ORIGIN_PATTERNS: ReadonlyArray<RegExp> = [
  /^https:\/\/(?:[a-z0-9-]+\.)*generationhealth\.me$/i,
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
];

export function isAllowedOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((p) => p.test(origin));
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = (req.headers.origin || '') as string;
  res.setHeader('Vary', 'Origin');
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return true;
  }
  return !origin;
}
