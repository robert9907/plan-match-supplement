import { useState } from 'react';

// "Does a Medigap plan cover dental?" — collapsible explainer for the rate
// chart / quote screen. Mirrors MedigapExplainer's accordion styling.
// Copy is the canonical supp.dental content (Medigap does NOT cover routine
// dental, but DOES pay the Part B 20% on Medicare-covered dental like jaw
// repair). Kept in sync with the consumer @plan-match/shared `supp.dental`
// explainer; this app doesn't consume that package, so the copy is local.
// Sources: Medicare.gov (Medigap benefits; dental services) + CMS Benefit
// Policy Manual Ch.15 §150.
export function DentalExplainer() {
  const [open, setOpen] = useState(false);

  return (
    <div className={`medigap-accordion${open ? ' open' : ''}`}>
      <button
        type="button"
        className="medigap-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="medigap-trigger-text">
          <span className="medigap-trigger-eyebrow">Dental &amp; a Medigap plan</span>
          <span className="medigap-trigger-title">Does a Medicare Supplement cover dental?</span>
        </span>
        <span className="medigap-trigger-chev" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="medigap-body">
          <p className="medigap-lede">
            A Medicare Supplement works alongside Original Medicare and pays <strong>your share of what
            Medicare covers</strong>. It does <strong>not</strong> add routine dental — no cleanings, fillings,
            dentures, bridges or implants. For those you&rsquo;d pair it with a standalone dental plan.
          </p>

          <div className="medigap-plans">
            <div className="medigap-plan">
              <div className="medigap-plan-name">What it does not cover</div>
              <div className="medigap-plan-desc">
                Routine dental — cleanings, fillings, dentures, bridges, implants. Medigap never adds these.
              </div>
            </div>
            <div className="medigap-plan">
              <div className="medigap-plan-name">What it does help with</div>
              <div className="medigap-plan-desc">
                When Medicare covers dental because it&rsquo;s medically necessary — like repairing your jaw
                after a car accident — Part B pays 80% and you&rsquo;d owe 20%. Your Medigap plan pays that
                Part B coinsurance, the same as any other Part B service (every plan A&ndash;N covers it).
              </div>
            </div>
          </div>

          <p className="medigap-lede">
            <strong>So after that car accident:</strong> Medicare and your Medigap plan together cover repairing
            the jaw. But replacing the teeth, or getting dentures or implants, is routine dental — that comes
            from a standalone dental plan, not Medigap.
          </p>
        </div>
      )}
    </div>
  );
}
