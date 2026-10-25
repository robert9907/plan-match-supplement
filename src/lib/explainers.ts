// "What does this mean?" explainer content for the Supplement flow — Level 1
// of the Explain → Ask Sarah → Talk to Rob layer. Same shape as the ACA
// app's src/lib/explainers.ts and the Medicare widget's
// packages/shared/src/explainers.ts.
//
// Medigap is state-regulated (NAIC Model Act + state DOI). This is general
// education only. It does NOT replace the regulated disclosures in
// MedigapDisclosures.tsx / MedSupRateDisclosure.tsx, and it never quotes a
// rate or promises acceptance.
//
// RULES for anyone editing:
//   - Every fact must trace to a listed source. No source, no sentence.
//   - Plain language, short sentences.
//   - Underwriting must be described as not guaranteed.
//   - Update `checked` whenever a card's facts are re-verified.

export interface ExplainerCard {
  states?: string[];
  tag?: string;
  heading: string;
  body: string;
}

export interface ExplainerSource {
  label: string;
  url: string;
}

export interface Explainer {
  id: string;
  eyebrow: string;
  cards: ExplainerCard[];
  callout?: string;
  sources: ExplainerSource[];
  checked: string;
}

const SRC = {
  gi: {
    label: 'Medicare.gov — When you can buy Medigap',
    url: 'https://www.medicare.gov/supplements-other-insurance/when-can-i-buy-medigap/guaranteed-issue-rights',
  },
  shipRights: {
    label: 'Indiana SHIP — Medigap Rights (from the CMS Medigap guide)',
    url: 'https://www.in.gov/ship/files/Medigap_Rights_print.pdf',
  },
} as const satisfies Record<string, ExplainerSource>;

export const EXPLAINERS: Readonly<Record<string, Explainer>> = {
  'supp.prompt': {
    id: 'supp.prompt',
    eyebrow: 'When you can buy a Medigap plan',
    cards: [
      {
        heading: 'Your Medigap Open Enrollment',
        body: 'Six months, starting the first month you’re 65 or older and have Part B. Insurers can’t turn you down or use your health to decide. It happens once and doesn’t repeat.',
      },
      {
        heading: 'Guaranteed issue rights',
        body: 'Some situations also guarantee you a plan — for example, if you tried Medicare Advantage for the first time (when you joined Medicare at 65, or by dropping a Medigap plan) and want out within the first year. You usually have 63 days to use these rights.',
      },
      {
        heading: 'Any other time',
        body: 'Insurers can ask health questions, and they can charge more or turn you down. That’s what the health check later in Plan Match is for.',
      },
    ],
    callout: 'Your state may give you extra rights. Rob can check which ones apply to you.',
    sources: [SRC.gi, SRC.shipRights],
    checked: '2026-10-25',
  },

  'supp.health': {
    id: 'supp.health',
    eyebrow: 'Why we ask health questions',
    cards: [
      {
        heading: 'It’s how insurers decide',
        body: 'Outside your Medigap Open Enrollment or a guaranteed issue right, insurers review your health before accepting you. Acceptance isn’t guaranteed — the final decision and rate come from the insurer’s underwriting.',
      },
      {
        heading: 'Inside your Open Enrollment?',
        body: 'Then insurers can’t use your health to turn you down. Rob can confirm whether you’re still in that window.',
      },
    ],
    sources: [SRC.gi],
    checked: '2026-10-25',
  },
};

export function getExplainer(id: string): Explainer | null {
  return EXPLAINERS[id] ?? null;
}
