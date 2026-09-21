import { useState } from 'react';

// The date the CMS Medigap Plan Finder was read, not a carrier filing date —
// CMS does not return one. Update this whenever the projection is reloaded.
const RATES_READ_ON = '21 September 2026';

// Medigap premiums vary by rating area inside a state, and this chart is drawn
// from ONE ZIP per state. Saying so is the difference between a rate quote and
// a rate representation: a Charlotte reader looking at a Durham curve is
// reading someone else's premium.
const REFERENCE_ZIP: Record<string, { zip: string; label: string }> = {
  NC: { zip: '27713', label: 'Durham County' },
  TX: { zip: '75201', label: 'Dallas County' },
};

interface MedSupRateDisclosureProps {
  effectiveDate?: string;
  gender?: string;
  tobacco?: string;
  planLetter?: string;
  state?: string;
}

export function MedSupRateDisclosure({
  effectiveDate,
  gender = 'male',
  tobacco = 'non-tobacco',
  planLetter = 'Plan G',
  state = 'NC',
}: MedSupRateDisclosureProps) {
  const [open, setOpen] = useState(false);
  const effective = effectiveDate || RATES_READ_ON;
  const ref = REFERENCE_ZIP[state.toUpperCase()];
  const isFemale = gender.toLowerCase() === 'female';
  const possessive = isFemale ? 'her' : 'his';
  const subject = isFemale ? 'she' : 'he';
  const comparisonSentence = isFemale
    ? 'Male premiums typically run 5–12% higher.'
    : 'Female premiums typically run 5–12% lower.';

  return (
    <div className="medsup-rate-disclosure" style={{ margin: '16px 0 0' }}>
      {/* ─────────────── Section A: methodology box ─────────────── */}
      <section
        style={{
          border: '1px solid rgba(13,47,94,0.14)',
          background: 'rgba(13,47,94,0.03)',
          borderRadius: 10,
          padding: '14px 16px',
          color: 'rgba(13,47,94,0.88)',
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontSize: 12,
            fontWeight: 700,
            color: 'rgba(13,47,94,0.6)',
            marginBottom: 6,
          }}
        >
          Methodology
        </div>
        <h3
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: '0 0 10px',
            color: 'rgba(13,47,94,0.95)',
          }}
        >
          How these rates were produced
        </h3>

        <p style={{ margin: '0 0 10px' }}>
          Premiums shown are current published rates for a {gender}, {tobacco}{' '}
          applicant enrolling in {planLetter} during {possessive} Medigap Open
          Enrollment Period — the six months beginning the month {subject}{' '}
          turns 65 and is enrolled in both Medicare Part A and Part B. During
          that window no medical underwriting applies; no applicant can be
          declined or charged more for health conditions. Some carriers on this
          chart file more than one version of {planLetter} at different prices;
          those tiers are explained below.
        </p>

        <p style={{ margin: '0 0 10px' }}>
          Household, spousal, and multi-policy discounts are not applied.{' '}
          {comparisonSentence} Tobacco premiums run higher.
        </p>

        <p style={{ margin: '0 0 10px' }}>
          <strong>This chart is a snapshot, not a forecast.</strong> Each point
          shows what a person of that age pays today. It does not include
          future rate increases. Carriers file general rate adjustments with
          the North Carolina Department of Insurance, and those increases
          compound on top of the age-band steps shown here. Your actual
          premium at 80 will be higher than the age-80 figure on this chart.
        </p>

        <div
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            color: 'rgba(13,47,94,0.6)',
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid rgba(13,47,94,0.1)',
          }}
        >
          {ref
            ? `Rates as listed by the CMS Medigap Plan Finder on ${effective} for ZIP ${ref.zip} (${ref.label}), the reference ZIP for this state. Premiums vary by ZIP within a state — yours may differ.`
            : `Rates as listed by the CMS Medigap Plan Finder on ${effective}. Premiums vary by ZIP within a state — yours may differ.`}{' '}
          Subject to change with regulatory approval. Every {planLetter} carrier
          CMS lists for that ZIP is shown, except those this agency is not
          appointed with. Robert Simm, NPN #10447418. Not connected with or endorsed by
          the U.S. Government or the federal Medicare program. This is a
          solicitation of insurance.
        </div>
      </section>

      {/* ─────────────── Section B: age-band education ─────────────── */}
      <div style={{ marginTop: 14 }}>
        <div className={`medigap-accordion${open ? ' open' : ''}`}>
          <button
            type="button"
            className="medigap-trigger"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <span className="medigap-trigger-text">
              <span className="medigap-trigger-eyebrow">Rate methodology</span>
              <span className="medigap-trigger-title">
                Why your premium changes with age
              </span>
            </span>
            <span className="medigap-trigger-chev" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M3 5l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {open && (
            <div className="medigap-body">
              <p style={{ margin: '0 0 12px' }}>
                Medicare Supplement carriers use one of three pricing methods.
              </p>

              <p style={{ margin: '0 0 10px' }}>
                <strong>Attained-age</strong> — your premium is based on your
                current age and rises as you enter each new age band. Cheapest
                at 65, most expensive at 80 and above. Most North Carolina
                carriers price this way, and it is what produces the curve
                above.
              </p>

              <p style={{ margin: '0 0 10px' }}>
                <strong>Issue-age</strong> — your premium is locked to the age
                you were when the policy was issued. It never rises because
                you got older. Usually costs more at 65 and less over a
                lifetime.
              </p>

              <p style={{ margin: '0 0 16px' }}>
                <strong>Community-rated</strong> — every policyholder pays the
                same premium regardless of age.
              </p>

              <h4 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>
                Why one carrier appears more than once
              </h4>

              <p style={{ margin: '0 0 10px' }}>
                Several carriers file more than one {planLetter}, at different
                prices &mdash; you will see them on the chart as Preferred,
                Standard, Level&nbsp;1, Level&nbsp;2 or Substandard. These are
                separate filings with their own rates, not discounts or options
                you choose between.
              </p>

              <p style={{ margin: '0 0 10px' }}>
                Which one a carrier offers you is decided by its own underwriting
                when you apply &mdash; your health history, your prescriptions,
                sometimes your height and weight. It is not decided by anything on
                this page, and it is not decided when you shop.
              </p>

              <p style={{ margin: '0 0 16px' }}>
                <strong>
                  During your Medigap Open Enrollment Period, or in a
                  guaranteed-issue situation, a carrier cannot decline you or
                  charge you more because of your health.
                </strong>{' '}
                Outside those windows it can, and the tier you are offered may not
                be the one you were looking at. Ask which tier a carrier will
                actually issue before you compare its price to anyone else's.
              </p>

              <h4
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  margin: '0 0 8px',
                }}
              >
                Two separate things raise your premium, and they stack
              </h4>

              <ol style={{ paddingLeft: 22, margin: '0 0 16px', lineHeight: 1.55 }}>
                <li style={{ marginBottom: 6 }}>
                  <strong>The age band.</strong> You move into the next tier
                  on the carrier's schedule.
                </li>
                <li>
                  <strong>The rate increase.</strong> The carrier files a
                  general increase with the North Carolina Department of
                  Insurance, applied to every policyholder in that block.
                </li>
              </ol>

              <p style={{ margin: '0 0 16px' }}>
                That is how a policyholder can see 8–12% in a single year —
                an age-band step and a filed increase inside the same twelve
                months. Neither one is reflected in the chart above, which
                shows only what each age pays today.
              </p>

              <h4
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  margin: '0 0 8px',
                }}
              >
                The part most people miss
              </h4>

              <p style={{ margin: 0 }}>
                The cheapest carrier at 65 is frequently not the cheapest at
                80. The lowest entry rates sometimes carry the steepest
                curves. You can switch carriers later, but outside your
                Medigap Open Enrollment Period or a guaranteed-issue situation
                you will answer health questions and can be declined. People
                who develop health conditions in their seventies often cannot
                move, and they ride whatever curve they chose at 65 &mdash; and
                whatever tier they were issued at.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
