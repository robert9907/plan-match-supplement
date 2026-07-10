// scripts/_smoke-happy-mocked.ts — smoke test
//
// Verifies the happy-path fetch sequence of api/enroll.ts with all HTTP
// stubbed. Confirms:
//   • supplement_applications INSERT fires exactly once (plan-match-prod).
//   • AgentBase clients lookup runs; new-client INSERT fires.
//   • AgentBase leads INSERT fires.
//   • Handler returns 200 { ok: true, submissionId }.
//   • SMS is skipped (AGENTBASE_SMS_URL unset).
//
// Contrast with _smoke-envmissing-502.ts which verifies the failure path
// when AGENTBASE_SUPABASE_* is unset.
//
// Run: npx tsx scripts/_smoke-happy-mocked.ts

process.env.AGENTBASE_SUPABASE_URL = 'https://fake-agentbase.supabase.co';
process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
process.env.SUPABASE_URL = 'https://fake-supplement.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-supplement-key';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.AGENTBASE_SMS_URL;

interface FetchLog {
  method: string;
  url: string;
  body: unknown;
}

const log: FetchLog[] = [];
const origFetch = global.fetch;

(global as unknown as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : input.toString();
  const method = (init?.method || 'GET').toUpperCase();
  let body: unknown = null;
  if (init?.body) {
    try {
      body = JSON.parse(init.body as string);
    } catch {
      body = init.body;
    }
  }
  log.push({ method, url, body });

  // Consumer plan-match-supplement's own DB — supplement_applications
  if (
    method === 'POST' &&
    url.includes('/rest/v1/supplement_applications')
  ) {
    return new Response(
      JSON.stringify([{ id: 'smoke-happy-sub-uuid-0001' }]),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }
  // AgentBase clients lookup — no existing client
  if (
    method === 'GET' &&
    url.includes('/rest/v1/clients?phone=ilike.')
  ) {
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // AgentBase clients INSERT
  if (
    method === 'POST' &&
    /\/rest\/v1\/clients$/.test(url.split('?')[0])
  ) {
    return new Response(null, { status: 201 });
  }
  // AgentBase leads INSERT
  if (method === 'POST' && url.includes('/rest/v1/leads')) {
    return new Response(null, { status: 201 });
  }
  console.error('[smoke] unhandled fetch:', method, url);
  return new Response('unhandled', { status: 599 });
}) as typeof fetch;

const payload = {
  firstName: 'Happy',
  lastName: 'Path',
  phone: '5550009999',
  email: 'happy.path@example.invalid',
  address: '1 Test St',
  city: 'Asheville',
  state: 'NC',
  zip: '28801',
  county: 'Buncombe',
  carrier: 'Aetna',
  planLetter: 'G' as const,
  mbiNumber: '1EG4TE5MK73',
  securityPin: '1234',
  dobMonth: '5',
  dobDay: '15',
  dobYear: '1955',
  age: 70,
  authChecks: [true, true, true, true, true] as const,
  tcpaConsentAt: new Date().toISOString(),
  signedAt: new Date().toISOString(),
  partAEffective: '05/01/2025',
  partBEffective: '05/01/2025',
  context: {
    medications: [
      { name: 'Metformin', dose: '500mg', status: 'active' },
    ],
    providers: [{ name: 'Dr. Smith', npi: '1234567890' }],
    healthAnswers: {},
    clusterCounts: {},
    comboFlags: [],
    escalationPattern: null,
  },
};

const { default: handler } = await import('../api/enroll.ts');

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

try {
  await handler(req, res);
} finally {
  global.fetch = origFetch;
}

console.log('\nStatus:', capturedStatus);
console.log('Body:', JSON.stringify(capturedBody, null, 2));

const calls = {
  supplementInsert: log.filter(
    (l) => l.method === 'POST' && l.url.includes('/supplement_applications'),
  ),
  clientsLookup: log.filter(
    (l) => l.method === 'GET' && l.url.includes('/clients?phone=ilike.'),
  ),
  clientsInsert: log.filter(
    (l) => l.method === 'POST' && /\/rest\/v1\/clients$/.test(l.url.split('?')[0]),
  ),
  leadsInsert: log.filter(
    (l) => l.method === 'POST' && l.url.includes('/rest/v1/leads'),
  ),
  smsCalls: log.filter((l) => l.url.includes('/api/send-sms')),
};

console.log('\nCall counts:');
for (const [k, v] of Object.entries(calls)) {
  console.log(`  ${k.padEnd(24)} ${v.length}`);
}

const checks: Array<[string, boolean]> = [
  ['status is 200', capturedStatus === 200],
  ['body.ok is true', capturedBody?.ok === true],
  ['submissionId present', typeof capturedBody?.submissionId === 'string'],
  ['supplement_applications POST once', calls.supplementInsert.length === 1],
  ['clients lookup once', calls.clientsLookup.length === 1],
  ['clients INSERT once', calls.clientsInsert.length === 1],
  ['leads INSERT once', calls.leadsInsert.length === 1],
  ['no SMS fired (env unset)', calls.smsCalls.length === 0],
];

console.log('\nChecks:');
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allOk = false;
}

console.log('\n' + '═'.repeat(64));
if (allOk) {
  console.log('✅ HAPPY PATH (MOCKED) PASSED');
  process.exit(0);
} else {
  console.log('❌ HAPPY PATH (MOCKED) FAILED');
  process.exit(1);
}
