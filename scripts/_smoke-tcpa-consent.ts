// scripts/_smoke-tcpa-consent.ts — smoke test
//
// Verifies that api/enroll.ts writes a TCPA consent record, and writes
// the SAME one, to both sinks:
//   • supplement_applications.context.tcpa_consent
//   • AgentBase leads.context.tcpa_consent
//
// and that the 4-tuple back-compat path — which validate() still accepts
// and which carries no TCPA checkbox — writes null rather than a record
// implying a consent nobody gave.
//
// Why this exists: before it, all 14 rows in supplement_applications
// stored consent as `authChecks: [true,true,true,true,true]` — positional
// bare booleans that record THAT five boxes were ticked and never what
// any of them said — with no timestamp, no IP, no user-agent and no
// disclosure text. Under the FCC One-to-One Consent rule the evidentiary
// questions are who, when, from what device, and to what; only "who" had
// an answer.
//
// Run: npx tsx scripts/_smoke-tcpa-consent.ts

process.env.AGENTBASE_SUPABASE_URL = 'https://fake-agentbase.supabase.co';
process.env.AGENTBASE_SUPABASE_SERVICE_ROLE_KEY = 'fake-key';
process.env.SUPABASE_URL = 'https://fake-supplement.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-supplement-key';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.AGENTBASE_SMS_URL;

import {
  TCPA_CONSENT_DISCLOSURE,
  TCPA_CONSENT_PREAMBLE,
  TCPA_CONSENT_VERSION,
} from '../api/_lib/tcpa-consent.ts';

interface FetchLog {
  method: string;
  url: string;
  body: unknown;
}

const CONSENT_AT = '2026-09-12T18:04:05.123Z';
const SIGNED_AT = '2026-09-12T18:04:31.900Z';
const CLIENT_IP = '203.0.113.77';
const PROXY_IP = '198.51.100.9';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) SmokeTest';

const basePayload = {
  firstName: 'Consent',
  lastName: 'Record',
  phone: '5550008888',
  email: 'consent.record@example.invalid',
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
  signedAt: SIGNED_AT,
  partAEffective: '05/01/2025',
  partBEffective: '05/01/2025',
  context: {
    medications: [],
    providers: [],
    healthAnswers: {},
    clusterCounts: {},
    comboFlags: [],
    escalationPattern: null,
  },
};

/** Run the real handler against stubbed HTTP; return what it tried to write. */
async function run(payload: unknown, headers: Record<string, string>) {
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

    if (method === 'POST' && url.includes('/rest/v1/supplement_applications')) {
      return new Response(JSON.stringify([{ id: 'smoke-tcpa-sub-0001' }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'GET' && url.includes('/rest/v1/clients?phone=ilike.')) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && /\/rest\/v1\/clients$/.test(url.split('?')[0])) {
      return new Response(JSON.stringify([{ id: 4242 }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (method === 'POST' && url.includes('/rest/v1/leads')) {
      return new Response(null, { status: 201 });
    }
    return new Response('unhandled', { status: 599 });
  }) as typeof fetch;

  const { default: handler } = await import('../api/enroll.ts');

  let status = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = { method: 'POST', body: payload, headers };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    setHeader: () => res,
    status: (n: number) => {
      status = n;
      return res;
    },
    json: () => res,
    end: () => res,
    headersSent: false,
  };

  try {
    await handler(req, res);
  } finally {
    global.fetch = origFetch;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pick = (pred: (l: FetchLog) => boolean): any =>
    (log.find(pred)?.body ?? null) as any;

  return {
    status,
    supplement: pick(
      (l) => l.method === 'POST' && l.url.includes('/supplement_applications'),
    ),
    lead: pick((l) => l.method === 'POST' && l.url.includes('/rest/v1/leads')),
  };
}

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

// ─── Case 1: 5-tuple — the current client. Full record expected. ───────
const five = await run(
  { ...basePayload, authChecks: [true, true, true, true, true], tcpaConsentAt: CONSENT_AT },
  {
    // Left-most entry is the real client; the rest is proxy chain.
    'x-forwarded-for': `${CLIENT_IP}, ${PROXY_IP}`,
    'user-agent': USER_AGENT,
  },
);

const sc = five.supplement?.context?.tcpa_consent;
const lc = five.lead?.context?.tcpa_consent;

check('5-tuple: handler returned 200', five.status === 200);
check('5-tuple: supplement_applications carries tcpa_consent', !!sc);
check('5-tuple: leads carries tcpa_consent', !!lc);
check(
  '5-tuple: both sinks got the IDENTICAL record',
  !!sc && !!lc && JSON.stringify(sc) === JSON.stringify(lc),
);
check('5-tuple: basis is prior express written consent',
  sc?.consent_basis === 'prior_express_written_consent');
check('5-tuple: consent_at is the checkbox stamp, not the signature',
  sc?.consent_at === CONSENT_AT);
check('5-tuple: consent_version recorded', sc?.consent_version === TCPA_CONSENT_VERSION);
check('5-tuple: consent_source identifies the surface',
  sc?.consent_source === 'plan_match_supplement');
check('5-tuple: consent_ip is the client, not the proxy',
  sc?.consent_ip === CLIENT_IP);
check('5-tuple: consent_user_agent captured', sc?.consent_user_agent === USER_AGENT);
check('5-tuple: consent_text carries the disclosure verbatim',
  typeof sc?.consent_text === 'string' && sc.consent_text.includes(TCPA_CONSENT_DISCLOSURE));
check('5-tuple: consent_text carries the not-a-condition preamble',
  typeof sc?.consent_text === 'string' && sc.consent_text.includes(TCPA_CONSENT_PREAMBLE));
check('5-tuple: raw authChecks still stored alongside',
  Array.isArray(five.supplement?.context?.authChecks));

// ─── Case 2: tcpaConsentAt absent — stale bundle. Fall back to signedAt.
const noStamp = await run(
  { ...basePayload, authChecks: [true, true, true, true, true] },
  { 'x-forwarded-for': CLIENT_IP, 'user-agent': USER_AGENT },
);
check('no stamp: record still written', !!noStamp.supplement?.context?.tcpa_consent);
check('no stamp: consent_at falls back to signedAt',
  noStamp.supplement?.context?.tcpa_consent?.consent_at === SIGNED_AT);

// ─── Case 3: 4-tuple back-compat — NO TCPA box was ever shown. ─────────
const four = await run(
  { ...basePayload, authChecks: [true, true, true, true] },
  { 'x-forwarded-for': CLIENT_IP, 'user-agent': USER_AGENT },
);
check('4-tuple: application is still accepted (200)', four.status === 200);
check('4-tuple: supplement_applications records NO consent',
  four.supplement?.context?.tcpa_consent === null);
check('4-tuple: leads records NO consent',
  four.lead?.context?.tcpa_consent === null);

// ─── Report ────────────────────────────────────────────────────────────
console.log('\nChecks:');
let allOk = true;
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) allOk = false;
}

console.log('\n' + '═'.repeat(64));
if (allOk) {
  console.log('✅ TCPA CONSENT RECORD PASSED');
  process.exit(0);
} else {
  console.log('❌ TCPA CONSENT RECORD FAILED');
  console.log('\nsupplement context.tcpa_consent (5-tuple case):');
  console.log(JSON.stringify(sc, null, 2));
  process.exit(1);
}
