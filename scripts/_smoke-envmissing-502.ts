// scripts/_smoke-envmissing-502.ts — smoke test
//
// Verifies the hardening applied to api/enroll.ts: when
// AGENTBASE_SUPABASE_URL / AGENTBASE_SUPABASE_SERVICE_ROLE_KEY are unset,
// bridgeToAgentBase throws and the handler now returns 502 (not 200) with
// { field: '_agentbase' }.
//
// The supplement_applications INSERT is stubbed via a fetch monkeypatch
// so this script never touches a real database.
//
// Run: npx tsx scripts/_smoke-envmissing-502.ts

// Force env state BEFORE importing the handler so persistToSupabase's
// key check and bridgeToAgentBase's env guard both see the intended
// values on first read.
delete process.env.AGENTBASE_SUPABASE_URL;
delete process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY;
delete process.env.AGENTBASE_SMS_URL;
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-supabase-service-role-key';
// api/_lib/crypto.ts throws if ENCRYPTION_KEY is missing. Any 64-char
// hex string works; the encrypted output is never inspected in this test.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Monkeypatch fetch so the supplement_applications INSERT resolves
// without a network call. If any other fetch fires, log it — the test
// shouldn't reach real HTTP for anything.
const origFetch = global.fetch;
(global as unknown as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/rest/v1/supplement_applications')) {
    return new Response(
      JSON.stringify([{ id: 'smoke-envmissing-uuid' }]),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }
  console.error('[smoke] unexpected fetch escape:', url);
  return origFetch(input, init);
}) as typeof fetch;

const { default: handler } = await import('../api/enroll.ts');

const payload = {
  firstName: 'Smoke',
  lastName: 'Test',
  phone: '5550009999',
  email: 'smoke.test@example.invalid',
  address: '1 Test St',
  city: 'Asheville',
  state: 'NC',
  zip: '28801',
  county: 'Buncombe',
  carrier: 'Aetna',
  planLetter: 'G' as const,
  // Real CMS example MBI (public spec value, not a live beneficiary).
  mbiNumber: '1EG4TE5MK73',
  securityPin: '1234',
  dobMonth: '5',
  dobDay: '15',
  dobYear: '1955',
  age: 70,
  authChecks: [true, true, true, true, true] as const,
  tcpaConsentAt: new Date().toISOString(),
  signedAt: new Date().toISOString(),
};

let capturedStatus = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedBody: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const req: any = { method: 'POST', body: payload, headers: {} };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const res: any = {
  setHeader: () => res,
  status: (n: number) => {
    capturedStatus = n;
    return res;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: (b: any) => {
    capturedBody = b;
    return res;
  },
  end: () => res,
  headersSent: false,
};

await handler(req, res);

console.log('Status:', capturedStatus);
console.log('Body:', JSON.stringify(capturedBody, null, 2));

const pass =
  capturedStatus === 502 &&
  capturedBody?.ok === false &&
  Array.isArray(capturedBody?.errors) &&
  capturedBody.errors.some(
    (e: { field?: string; message?: string }) => e?.field === '_agentbase',
  );

if (pass) {
  console.log('\n✅ PASS — 502 with { field: "_agentbase" } as expected');
  process.exit(0);
} else {
  console.error('\n❌ FAIL — expected 502 with _agentbase error');
  process.exit(1);
}
