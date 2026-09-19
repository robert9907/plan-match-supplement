// ---------------------------------------------------------------------------
// RateSourceDisclosure — what the rates on screen actually are.
//
// ONE component, rendered on both /rates and /results, because this text was
// duplicated in two files and both copies were wrong in the same way. The old
// wording said:
//
//   "Rates shown are from carriers Generation Health is appointed with and do
//    not represent every Medicare Supplement insurer available in your area."
//
// Neither clause was true. The rates come from pm_supp_carrier_rates — the CMS
// Plan Finder scrape — filtered only by the three-carrier suppression list in
// migration 005. That is 34 of 38 filed companies in NC, 29 of 32 in TX, 26 of
// 28 in GA. Meanwhile pm_medsup_carrier, which holds the actual appointments,
// has 15 rows for NC. So the screen was claiming a curated list of carriers Rob
// can write, while showing very nearly every insurer filed in the state.
//
// That is the dangerous direction to be wrong in: a consumer picks a carrier
// believing Rob is their agent for it, and he cannot submit the application.
// NAIC Model Act §22 marketing standards.
//
// Rob's ruling (2026-09-19): keep showing every carrier — it matches the Plan
// Match decision to show all plans rather than only commissionable ones, and
// route non-appointed interest to him directly — and make the sentence
// describe what is actually on screen.
//
// Do not re-add an appointment claim here. If the product ever does filter to
// appointments, change the data first and this text second, in that order.
//
// Phrasing note: the sentence is "is NOT appointed with every carrier listed",
// not "not a list of carriers we are appointed with". Both are true, but the
// harness rule matches the positive claim as a substring and the second form
// trips it. Saying what is not true about the list, rather than negating a
// claim about it, is clearer to read and unambiguous to check.
// ---------------------------------------------------------------------------

interface RateSourceDisclosureProps {
  /** Inline style overrides for the two call sites' differing layouts. */
  style?: React.CSSProperties;
  className?: string;
}

export function RateSourceDisclosure({ style, className }: RateSourceDisclosureProps) {
  return (
    <div
      className={className ?? 'ms-appointment-disclosure'}
      style={{ fontSize: 12, lineHeight: 1.4, color: '#6B7280', margin: '16px 4px 0', ...style }}
    >
      Rates shown are Medicare Supplement premiums as filed with CMS for your state.
      Generation Health is not appointed with every carrier listed — if you choose one Rob
      cannot write, he'll point you to them directly rather than take the application. A
      small number of carriers are left out because they do not broker through independent
      agents. Premiums are estimates sourced from Medicare.gov and are not a quote or a
      guarantee of coverage. Final acceptance and premium are determined by each carrier's
      underwriting department. Rob Simm, NPN #10447418.
    </div>
  );
}
