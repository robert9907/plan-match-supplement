import type { FlowState } from '../context/FlowContext';

export interface SubmitResult {
  ok: boolean;
  submissionId?: string;
  errors?: Array<{ field: string; message: string }>;
}

// Builds the POST /api/enroll payload from FlowContext state and submits it.
// The server validates + persists; this function just shapes and forwards.
export async function submitApplication(flow: FlowState, age: number): Promise<SubmitResult> {
  const carrier = flow.selectedCarrier;
  if (!carrier || !flow.scoring) {
    return { ok: false, errors: [{ field: '_state', message: 'No plan selected.' }] };
  }

  const planLetter = flow.selectedPlan;
  const rateLo = planLetter === 'G' ? carrier.planGLo : carrier.planNLo;
  const rateHi = planLetter === 'G' ? carrier.planGHi : carrier.planNHi;

  const clusterCounts = Object.fromEntries(
    Object.entries(flow.scoring.clusters).filter(([, v]) => v > 0),
  );

  const medications = flow.meds.map((m) => ({
    name: m.name,
    dose: m.dose,
    status: m.status,
    statusText: m.statusText,
  }));

  const payload = {
    // Contact + address
    firstName: flow.application.firstName,
    lastName: flow.application.lastName,
    phone: flow.application.phone,
    email: flow.application.email,
    address: flow.application.addressLine,
    city: flow.application.city,
    state: flow.application.state,
    zip: flow.application.zip || flow.zip,
    county: null,

    // Product + plan
    product: 'supplement' as const,
    carrier: carrier.name,
    planLetter,

    // Scoring
    rateClassPredicted: carrier.rateClass.name,
    qualificationScore: flow.scoring.overall,
    rateRangeLow: rateLo,
    rateRangeHigh: rateHi,

    // Medicare
    mbiNumber: flow.application.mbi,
    securityPin: flow.application.securityPin,
    partAEffective: flow.application.partAEffective || null,
    partBEffective: flow.application.partBEffective || null,

    // Demographics
    dobMonth: flow.dob.month,
    dobDay: flow.dob.day,
    dobYear: flow.dob.year,
    age,
    gender: flow.gender,
    tobaccoUse: flow.tobacco,
    heightInches: flow.heightIn,
    weightLbs: flow.weightLbs,
    buildClass: flow.scoring.buildClassLabel,

    // Intent
    enrollmentPrompt: flow.prompt,

    // Auth + sig
    authChecks: flow.application.authChecks,
    signedAt: flow.application.signedAt,

    // Full screening context
    context: {
      medications,
      healthAnswers: flow.health as unknown as Record<string, unknown>,
      clusterCounts,
      comboFlags: flow.scoring.comboFlags,
      escalationPattern:
        flow.scoring.comboFlags.find((f) => f.toLowerCase().includes('escalation')) ?? null,
      providers: flow.providers.map((p) => ({
        name: p.name,
        ...(p.npi ? { npi: p.npi } : {}),
      })),
    },
  };

  const resp = await fetch('/api/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Read the body as text first. Vercel returns HTML on function crash /
  // timeout — reading text lets us surface the actual error instead of a
  // useless "Unexpected server response (500)." When the server responds
  // properly, the text still parses as JSON below.
  const rawText = await resp.text();

  let data: SubmitResult;
  try {
    data = JSON.parse(rawText) as SubmitResult;
  } catch {
    // Non-JSON body — log the first 500 chars so the console has the real
    // error, then surface a short snippet in the UI.
    console.error('[submitApplication] non-JSON response', {
      status: resp.status,
      contentType: resp.headers.get('content-type'),
      bodyPreview: rawText.slice(0, 500),
    });
    const snippet = rawText.replace(/\s+/g, ' ').trim().slice(0, 160);
    return {
      ok: false,
      errors: [
        {
          field: '_server',
          message: `Server returned ${resp.status} (non-JSON): ${snippet || '(empty body)'}`,
        },
      ],
    };
  }
  return data;
}
