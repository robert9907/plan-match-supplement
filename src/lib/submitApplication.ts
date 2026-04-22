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
      providers: [] as Array<{ name: string }>,
    },
  };

  const resp = await fetch('/api/enroll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  let data: SubmitResult;
  try {
    data = (await resp.json()) as SubmitResult;
  } catch {
    return {
      ok: false,
      errors: [{ field: '_server', message: `Unexpected server response (${resp.status}).` }],
    };
  }
  return data;
}
