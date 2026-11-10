import type { ReactNode } from 'react';
import { NondiscriminationFooter } from './NondiscriminationFooter';

interface FrameProps {
  /** Which step dot is current (1-5). Pass null for no dots. */
  step?: 1 | 2 | 3 | 4 | 5 | null;
  /** Override the top-right tag. Default: "MEDICARE · SUPPLEMENT". */
  tag?: string;
  /** If true, hides the 5 progress dots (used on application/handshake). */
  hideDots?: boolean;
  children: ReactNode;
  /** Redacts taps/entries on this screen in funnel tracking (data-pm-private). */
  privateArea?: string;
}

export function Frame({ step = 1, tag = 'MEDICARE · SUPPLEMENT', hideDots = false, children, privateArea }: FrameProps) {
  return (
    <div className="frame" data-pm-private={privateArea}>
      <div className="topbar">
        <div className="topbar-logo">PM</div>
        <div className="topbar-name">Plan Match</div>
        {!hideDots && (
          <div className="topbar-dots">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={
                  step == null
                    ? 'topbar-dot'
                    : i < step
                      ? 'topbar-dot done'
                      : i === step
                        ? 'topbar-dot on'
                        : 'topbar-dot'
                }
              />
            ))}
          </div>
        )}
        <div className="topbar-tag">{tag}</div>
      </div>
      <div className="scr">
        {children}
        <NondiscriminationFooter />
      </div>
    </div>
  );
}

interface BackRowProps {
  onClick: () => void;
}

export function BackRow({ onClick }: BackRowProps) {
  return (
    <button className="back-row" onClick={onClick} type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>Back</span>
    </button>
  );
}
