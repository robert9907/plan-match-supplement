// Section 1557 nondiscrimination notice + top-15 language taglines.
//
// Rendered as the global footer of every Frame so the consumer sees it on
// every screen of the Supplement flow (About → RateProjection → Meds →
// Health → Results → Compare → Application → Handshake).

import {
  BROKER_PHONE_DISPLAY,
  HHS_OCR_COMPLAINT_PORTAL,
  LANGUAGE_TAGLINES,
  ROB_GRIEVANCE_CONTACT,
} from '../lib/section-1557';

export function NondiscriminationFooter() {
  return (
    <div
      className="disclaimer"
      style={{
        marginTop: 16,
        paddingTop: 16,
        borderTop: '1px solid rgba(0,0,0,0.08)',
        fontSize: 11,
        lineHeight: 1.45,
        color: 'rgba(0,0,0,0.65)',
      }}
    >
      {/* Marketing-material attribution + CMS-not-reviewed clause. The
          Supplement (Medigap) flow is independent-broker tooling — not
          a CMS-reviewed plan-sponsor piece — so the data-sourcing and
          "official information" pointer is required up-front. */}
      <p style={{ margin: 0 }}>
        This website is operated by GenerationHealth.me, a licensed
        independent insurance agency (NPN 10447418). Plan details,
        benefits, and costs shown are sourced from CMS public data and
        are believed accurate but have not been reviewed or approved by
        CMS or any Medicare plan. For official plan information, visit{' '}
        <a
          href="https://www.medicare.gov"
          target="_blank"
          rel="noopener noreferrer"
        >
          Medicare.gov
        </a>{' '}
        or call 1-800-MEDICARE (1-800-633-4227), 24 hours a day, 7 days
        a week. TTY users call 1-877-486-2048.
      </p>

      <p style={{ margin: '12px 0 0', fontWeight: 600 }}>Nondiscrimination Notice</p>
      <p style={{ margin: '4px 0 0' }}>
        GenerationHealth.me complies with applicable Federal civil rights laws
        and does not discriminate on the basis of race, color, national origin,
        age, disability, or sex. GenerationHealth.me does not exclude people or
        treat them differently because of race, color, national origin, age,
        disability, or sex.
      </p>
      <p style={{ margin: '6px 0 0' }}>
        If you believe that GenerationHealth.me has failed to provide these
        services or discriminated in another way on the basis of race, color,
        national origin, age, disability, or sex, you can file a grievance
        with: {ROB_GRIEVANCE_CONTACT.name}, {ROB_GRIEVANCE_CONTACT.street},{' '}
        {ROB_GRIEVANCE_CONTACT.cityStateZip} · Phone:{' '}
        {ROB_GRIEVANCE_CONTACT.phone} (TTY: {ROB_GRIEVANCE_CONTACT.tty}).
      </p>
      <p style={{ margin: '6px 0 0' }}>
        You can also file a civil rights complaint with the U.S. Department of
        Health and Human Services, Office for Civil Rights electronically
        through the Office for Civil Rights Complaint Portal at{' '}
        <a href={HHS_OCR_COMPLAINT_PORTAL} target="_blank" rel="noopener noreferrer">
          {HHS_OCR_COMPLAINT_PORTAL}
        </a>
        , or by mail or phone at: U.S. Department of Health and Human Services,
        200 Independence Avenue, SW, Room 509F, HHS Building, Washington, D.C.
        20201 · 1-800-368-1019, 800-537-7697 (TDD).
      </p>

      <p style={{ margin: '12px 0 0', fontWeight: 600 }}>
        ATTENTION: Language assistance services, free of charge, are available
        to you. Call {BROKER_PHONE_DISPLAY} (TTY: 711).
      </p>
      {LANGUAGE_TAGLINES.map((t) => (
        <p key={t.lang} style={{ margin: '4px 0 0' }} lang={t.lang}>
          {t.text(BROKER_PHONE_DISPLAY, '711')}
        </p>
      ))}
    </div>
  );
}
