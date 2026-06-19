// MbiCardScan — live camera scan entry point for the Medicare card.
//
//   - Prominent "Scan your Medicare card" button above the MBI input.
//   - Tap opens a fullscreen viewfinder with the device's rear camera,
//     sized to the ISO/IEC 7810 ID-1 card ratio (1.586:1).
//   - Shutter captures the current frame and posts it to /api/scan-mbi
//     (Claude Vision). On a confident read, the bottom sheet opens with
//     the MBI + Part A/B start dates pre-filled and the user only has
//     to confirm. On a low-confidence read or Vision failure, the sheet
//     opens with empty fields and a "Couldn't read your card — enter
//     manually" hint so the user types from the photo as before.
//   - Permission denial closes the overlay so the manual MBI input below
//     remains available as the fallback.

import { useEffect, useState } from 'react';
import { useAutoAdvance } from '../hooks/useAutoAdvance';
import { useCameraStream } from '../hooks/useCameraStream';
import { useMbiScan } from '../hooks/useMbiScan';
import { normalizeMbi } from '../lib/mbiValidation';

// Inlined icons — supplement repo has no shared Icons component and its
// own convention is inline SVG everywhere (see PillScanSheet, Application.tsx).
function IconCamera() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2" y="4" width="20" height="16" rx={2} />
      <circle cx="12" cy="12" r={3} />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export interface MbiScanResult {
  /** 11-char CMS MBI, no dashes, uppercase. */
  mbi: string;
  /** Zero-padded 2-digit month string ("01".."12") for Part A. */
  partAMonth: string;
  /** 4-digit year string for Part A. */
  partAYear: string;
  partBMonth: string;
  partBYear: string;
}

interface Props {
  onConfirm: (result: MbiScanResult) => void;
  className?: string;
}

// Dashes at 4-3-4 for display only; the value passed on confirm is
// normalized (no dashes, uppercase).
function formatForDisplay(raw: string): string {
  const v = normalizeMbi(raw).slice(0, 11);
  if (v.length <= 4) return v;
  if (v.length <= 7) return `${v.slice(0, 4)}-${v.slice(4)}`;
  return `${v.slice(0, 4)}-${v.slice(4, 7)}-${v.slice(7)}`;
}

function sanitizeMbiInput(raw: string): string {
  return normalizeMbi(raw).slice(0, 11);
}
function sanitizeMonth(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 2);
}
function sanitizeYear(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}
function mbiValid(m: string): boolean {
  return /^[A-Z0-9]{11}$/.test(m);
}
function monthValid(m: string): boolean {
  if (!/^\d{2}$/.test(m)) return false;
  const n = Number(m);
  return n >= 1 && n <= 12;
}
function yearValid(y: string): boolean {
  if (!/^\d{4}$/.test(y)) return false;
  const n = Number(y);
  return n >= 1900 && n <= 2100;
}

export function MbiCardScan({ onConfirm, className }: Props) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const [mbi, setMbi] = useState('');
  const [partAMonth, setPartAMonth] = useState('');
  const [partAYear, setPartAYear] = useState('');
  const [partBMonth, setPartBMonth] = useState('');
  const [partBYear, setPartBYear] = useState('');

  // Auto-advance chain for the MBI + Part A/B fields in the bottom sheet.
  // Programmatic Vision-scan fills don't trigger advancement (no onChange).
  const { register, maybeAdvance } = useAutoAdvance();

  // True after we've called /api/scan-mbi and Vision returned low
  // confidence (or failed entirely). Drives the "Couldn't read your
  // card — enter manually" hint above the bottom-sheet inputs.
  const [scanFallback, setScanFallback] = useState(false);

  const { videoRef, status, error, capture, stop } = useCameraStream(open && !photo);
  const { scan: scanMbi, loading: scanLoading } = useMbiScan();

  // Close the overlay if the camera can't start — the manual MBI input
  // right below the button handles fallback entry.
  useEffect(() => {
    if (!open) return;
    if (status === 'denied' || status === 'unsupported' || status === 'error') {
      const t = window.setTimeout(() => setOpen(false), 1800);
      return () => window.clearTimeout(t);
    }
  }, [status, open]);

  const canConfirm =
    !!photo &&
    mbiValid(mbi) &&
    monthValid(partAMonth) &&
    yearValid(partAYear) &&
    monthValid(partBMonth) &&
    yearValid(partBYear);

  function close() {
    stop();
    setOpen(false);
    setPhoto(null);
    setMbi('');
    setPartAMonth('');
    setPartAYear('');
    setPartBMonth('');
    setPartBYear('');
    setScanFallback(false);
  }

  async function shoot() {
    if (status !== 'ready') return;
    const dataUrl = capture();
    if (!dataUrl) return;
    setPhoto(dataUrl);
    stop();

    // Post to /api/scan-mbi. On a confident read, populate the four
    // fields so the user only has to confirm. On low confidence /
    // Vision failure, leave fields empty and flip scanFallback so the
    // sheet shows the "enter manually" hint. We pre-fill any
    // individual fields the server *did* read confidently, even on
    // overall-fallback responses — no point making the user re-type
    // a valid Part A start when only the MBI was unreadable.
    setScanFallback(false);
    const resp = await scanMbi(dataUrl);
    const card = resp.card;
    if (card) {
      if (card.mbi) setMbi(sanitizeMbiInput(card.mbi));
      if (card.partAMonth) setPartAMonth(sanitizeMonth(card.partAMonth));
      if (card.partAYear) setPartAYear(sanitizeYear(card.partAYear));
      if (card.partBMonth) setPartBMonth(sanitizeMonth(card.partBMonth));
      if (card.partBYear) setPartBYear(sanitizeYear(card.partBYear));
    }
    if (!resp.ok || resp.fallback) setScanFallback(true);
  }

  function rescan() {
    setPhoto(null);
    setMbi('');
    setPartAMonth('');
    setPartAYear('');
    setPartBMonth('');
    setPartBYear('');
    setScanFallback(false);
  }

  function confirm() {
    if (!canConfirm) return;
    onConfirm({
      mbi: normalizeMbi(mbi),
      partAMonth,
      partAYear,
      partBMonth,
      partBYear,
    });
    close();
  }

  return (
    <>
      <button
        type="button"
        className={['mbi-scan-btn', className].filter(Boolean).join(' ')}
        onClick={() => setOpen(true)}
      >
        <span className="mbi-scan-btn-icon" aria-hidden="true">
          <IconCamera />
        </span>
        <span className="mbi-scan-btn-label">
          <span className="mbi-scan-btn-title">Scan your Medicare card</span>
          <span className="mbi-scan-btn-sub">Capture it, then confirm MBI and start dates</span>
        </span>
      </button>

      {open && (
        <div className="mbi-scan-overlay" role="dialog" aria-label="Medicare card scanner">
          <button
            type="button"
            className="mbi-scan-close"
            onClick={close}
            aria-label="Cancel scan"
          >
            <IconX />
          </button>

          {!photo && (
            <>
              <div className="mbi-scan-frame">
                <video
                  ref={videoRef}
                  className="mbi-scan-video"
                  playsInline
                  muted
                  autoPlay
                />
                {status === 'ready' && <div className="mbi-scan-sweep" />}
              </div>
              <div className="mbi-scan-status">
                {status === 'requesting' && 'Opening camera…'}
                {status === 'ready' && 'Frame the card, then tap capture'}
                {status === 'denied' && 'Camera access needed — closing scanner'}
                {status === 'unsupported' && 'No camera — closing scanner'}
                {status === 'error' && (error ?? 'Camera unavailable')}
              </div>

              {status === 'ready' && (
                <div className="shutter-row" style={{ marginTop: 20 }}>
                  <button
                    type="button"
                    className="shutter-btn"
                    onClick={shoot}
                    aria-label="Capture"
                  />
                </div>
              )}
            </>
          )}

          {photo && (
            <div className="mbi-scan-sheet" role="dialog" aria-label="Confirm card details">
              <div className="mbi-scan-sheet-handle" />
              <div className="mbi-scan-sheet-title">
                {scanLoading
                  ? 'Reading your card…'
                  : scanFallback
                    ? "Couldn't read your card — enter manually"
                    : "Confirm what's on your card"}
              </div>

              <div className="scan-capture-preview" style={{ maxHeight: 130 }}>
                <img src={photo} alt="Captured Medicare card" />
              </div>

              <div style={{ marginTop: 12 }}>
                <span className="mbi-scan-sheet-field-label">Medicare Number (MBI)</span>
                <input
                  className="mbi-scan-sheet-input mono"
                  inputMode="text"
                  autoCapitalize="characters"
                  placeholder="1ABC-DE2-FG34"
                  value={formatForDisplay(mbi)}
                  ref={register('mbi')}
                  onChange={(e) => {
                    const next = sanitizeMbiInput(e.target.value);
                    // Normalized MBI is 11 chars (no dashes); compare raw lengths.
                    maybeAdvance(mbi, next, 11, 'partAMonth');
                    setMbi(next);
                  }}
                  aria-label="MBI"
                  style={{ fontSize: 18, marginTop: 6, letterSpacing: '0.08em' }}
                />
              </div>

              <div className="mbi-scan-sheet-row">
                <div className="mbi-scan-sheet-field">
                  <span className="mbi-scan-sheet-field-label">Part A start</span>
                  <div className="mbi-scan-sheet-mmyyyy">
                    <input
                      className="mbi-scan-sheet-input mono"
                      placeholder="MM"
                      inputMode="numeric"
                      maxLength={2}
                      value={partAMonth}
                      ref={register('partAMonth')}
                      onChange={(e) => {
                        const next = sanitizeMonth(e.target.value);
                        maybeAdvance(partAMonth, next, 2, 'partAYear');
                        setPartAMonth(next);
                      }}
                      aria-label="Part A month"
                    />
                    <input
                      className="mbi-scan-sheet-input mono"
                      placeholder="YYYY"
                      inputMode="numeric"
                      maxLength={4}
                      value={partAYear}
                      ref={register('partAYear')}
                      onChange={(e) => {
                        const next = sanitizeYear(e.target.value);
                        maybeAdvance(partAYear, next, 4, 'partBMonth');
                        setPartAYear(next);
                      }}
                      aria-label="Part A year"
                    />
                  </div>
                </div>
                <div className="mbi-scan-sheet-field">
                  <span className="mbi-scan-sheet-field-label">Part B start</span>
                  <div className="mbi-scan-sheet-mmyyyy">
                    <input
                      className="mbi-scan-sheet-input mono"
                      placeholder="MM"
                      inputMode="numeric"
                      maxLength={2}
                      value={partBMonth}
                      ref={register('partBMonth')}
                      onChange={(e) => {
                        const next = sanitizeMonth(e.target.value);
                        maybeAdvance(partBMonth, next, 2, 'partBYear');
                        setPartBMonth(next);
                      }}
                      aria-label="Part B month"
                    />
                    <input
                      className="mbi-scan-sheet-input mono"
                      placeholder="YYYY"
                      inputMode="numeric"
                      maxLength={4}
                      value={partBYear}
                      ref={register('partBYear')}
                      onChange={(e) => setPartBYear(sanitizeYear(e.target.value))}
                      aria-label="Part B year"
                    />
                  </div>
                </div>
              </div>

              <div className="mbi-scan-sheet-hint">
                {scanLoading
                  ? 'Hang tight — extracting the MBI and start dates.'
                  : scanFallback
                    ? 'Type each value from the photo above. Tap Rescan to try the camera again.'
                    : 'Double-check each value matches the photo, then confirm.'}
              </div>
              <button
                type="button"
                className="mbi-scan-sheet-confirm"
                onClick={confirm}
                disabled={!canConfirm}
              >
                Confirm &amp; fill application
              </button>
              <button type="button" className="mbi-scan-sheet-retry" onClick={rescan}>
                Rescan
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
