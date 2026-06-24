// Medigap consumer disclosures: Guaranteed Issue Rights enumeration +
// rating-methodology explainer.
//
// W1 audit CRITICAL #3 (no Guaranteed Issue Rights disclosure) and
// CRITICAL #2 (no state-specific rating methodology disclosure) both
// landed on the Supplement audit. CMS Medigap Guide §3 + 42 CFR § 403.205
// require the full 7-event GI enumeration with the 63-day enrollment
// window. NAIC Medicare Supplement Insurance Minimum Standards Model
// Act §13 requires the rating-methodology disclosure (community-rated
// vs issue-age-rated vs attained-age-rated) on consumer materials —
// especially relevant here because api/rates.ts:stateForZip defaults
// to NC (community-rated) but TX/GA carriers commonly use attained-age
// methodology.

import { useState } from 'react';

interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Collapsible({ title, defaultOpen = false, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`medigap-accordion${open ? ' open' : ''}`}>
      <button
        type="button"
        className="medigap-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="medigap-trigger-text">
          <span className="medigap-trigger-title">{title}</span>
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
      {open && <div className="medigap-body">{children}</div>}
    </div>
  );
}

export function MedigapDisclosures() {
  return (
    <div className="medigap-disclosures">
      <Collapsible title="Guaranteed Issue (GI) rights — when carriers can't deny you">
        <p>
          Under federal law, certain life events trigger Medigap "guaranteed
          issue" rights. During a guaranteed-issue period, insurance companies
          cannot deny you coverage, charge you more because of your health, or
          make you wait for coverage to start. You generally have a{' '}
          <strong>63-day window</strong> from the qualifying event to enroll.
        </p>
        <ol style={{ paddingLeft: 20, lineHeight: 1.55 }}>
          <li>
            You're in your <strong>Medigap Open Enrollment Period</strong> —
            the 6-month window that starts the month you turn 65 and are
            enrolled in Medicare Part B.
          </li>
          <li>
            Your <strong>Medicare Advantage plan is leaving your area</strong>{' '}
            or stopping participation in Medicare.
          </li>
          <li>
            You <strong>moved out of your plan's service area</strong>.
          </li>
          <li>
            You're <strong>leaving employer or union group health coverage</strong>{' '}
            (including retiree coverage) that paid after Medicare.
          </li>
          <li>
            Your Medigap insurance company <strong>goes bankrupt</strong> or
            misled you, and you lose coverage as a result.
          </li>
          <li>
            <strong>Trial right (Medicare Advantage).</strong> You joined a
            Medicare Advantage plan or PACE for the first time, have been on
            it less than 12 months, and want to switch back to Original Medicare
            + Medigap.
          </li>
          <li>
            <strong>Trial right (Medicare SELECT).</strong> You dropped a
            Medigap policy to join a Medicare SELECT plan and want to switch
            back within 12 months.
          </li>
        </ol>
        <p style={{ marginTop: 8 }}>
          <em>
            Source: CMS Medicare &amp; You; 42 CFR § 403.205. This is a summary;
            for the full rules call 1-800-MEDICARE (1-800-633-4227, TTY:
            1-877-486-2048) or visit{' '}
            <a href="https://www.medicare.gov/" target="_blank" rel="noopener noreferrer">
              medicare.gov
            </a>
            .
          </em>
        </p>
      </Collapsible>

      <Collapsible title="How Medigap rates work — community-rated vs issue-age vs attained-age">
        <p>
          Medigap premiums are calculated using one of three rating methods.
          Carriers in your state may use any of them, and the method affects
          how (and whether) your premium changes over time.
        </p>
        <ul style={{ paddingLeft: 20, lineHeight: 1.55 }}>
          <li>
            <strong>Community-rated (common in North Carolina).</strong> Your
            premium does not depend on your age. Everyone of any age pays the
            same rate. Premiums can still increase over time due to inflation
            and rising medical costs, but not because you got older.
          </li>
          <li>
            <strong>Issue-age-rated.</strong> Your premium is based on your
            age when you first buy the policy. The premium will not increase
            because you get older — only because of inflation and rising
            medical costs.
          </li>
          <li>
            <strong>Attained-age-rated (common in Texas and Georgia).</strong>{' '}
            Your premium is based on your current age and{' '}
            <strong>increases as you get older</strong>, in addition to
            inflation. This often starts out as the lowest premium and grows
            the fastest.
          </li>
        </ul>
        <p style={{ marginTop: 8 }}>
          The rate type for each carrier is shown next to its premium on the
          results page. Identical plan letters (e.g. Plan G) cover the same
          federally-standardized benefits regardless of carrier or rating
          method — only the price differs.
        </p>
        <p>
          <em>
            Source: NAIC Medicare Supplement Insurance Minimum Standards Model
            Act § 13; CMS Medicare &amp; You.
          </em>
        </p>
      </Collapsible>
    </div>
  );
}
