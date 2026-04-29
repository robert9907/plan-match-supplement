import { useEffect, useState } from 'react';
import { useCameraStream } from '../hooks/useCameraStream';
import { useLabelScan, type LabelScanResult } from '../hooks/useLabelScan';
import { DRUG_CATALOG, type DrugCatalogItem } from '../lib/ddlData';

// ─── Helpers ──────────────────────────────────────────────────────

// First lowercase token — "Gabapentin" → "gabapentin",
// "Ozempic (semaglutide)" → "ozempic". Mirrors ddlLookup so a
// catalog hit and a DDL hit agree on the same key.
function firstToken(name: string): string {
  return name.toLowerCase().split(/[\s(]/)[0];
}

function findCatalogMatch(ocrName: string): DrugCatalogItem | null {
  const key = firstToken(ocrName);
  if (!key) return null;
  return DRUG_CATALOG.find((d) => firstToken(d.name) === key) ?? null;
}

// Strip strength tokens + trailing brackets, then title-case. The OCR
// result for "Gabapentin 300 MG Cap" should display as "Gabapentin".
function cleanDrugName(raw: string): string {
  let out = (raw || '').trim();
  out = out.replace(/\s*\[[^\]]+\]\s*$/g, '');
  out = out.replace(
    /\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?\s*(?:mg|mcg|g|ml|unt|iu|%)(?:\s*\/\s*(?:ml|actuat))?\b/gi,
    ' ',
  );
  out = out.replace(/\s+/g, ' ').trim();
  return out
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// ─── Component ────────────────────────────────────────────────────

type Stage = 'camera' | 'reading' | 'review' | 'fallback';

interface Props {
  /** Called with a confirmed drug name + dose. Parent runs classifyMed
   *  + addMed; this sheet stays UI-only so it can be reused later. */
  onConfirm: (drug: { name: string; dose: string }) => void;
  onClose: () => void;
}

export function PillScanSheet({ onConfirm, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('camera');
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [label, setLabel] = useState<LabelScanResult | null>(null);
  const [typed, setTyped] = useState('');

  const cameraActive = stage === 'camera';
  const { videoRef, status, error, capture, stop } = useCameraStream(cameraActive);
  const { scan } = useLabelScan();

  // Bounce to fallback typing if camera permissions were denied — don't
  // strand the user on a black viewfinder.
  useEffect(() => {
    if (status === 'denied' || status === 'unsupported' || status === 'error') {
      const t = window.setTimeout(() => setStage('fallback'), 1400);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  async function onShutter() {
    if (status !== 'ready') return;
    const dataUrl = capture();
    if (!dataUrl) return;
    setCapturedPhoto(dataUrl);
    stop();
    setStage('reading');
    const { label: scanned } = await scan(dataUrl);
    // Preserve the label whenever it carries a drug name, even on
    // low confidence — the review card is itself a confirm-or-retype
    // prompt, which beats discarding the OCR result and forcing the
    // user back to typing. Mirrors the consumer fix in d4395cf.
    if (scanned && scanned.drugName) {
      setLabel(scanned);
      setStage('review');
    } else {
      setLabel(null);
      setStage('fallback');
    }
  }

  function confirmFromVision() {
    if (!label || !label.drugName) return;
    const catalogHit = findCatalogMatch(label.drugName);
    const displayName = catalogHit?.name ?? cleanDrugName(label.drugName);
    const dose = label.strength ?? catalogHit?.dose ?? '';
    onConfirm({ name: displayName, dose });
  }

  function confirmTyped() {
    const cleaned = cleanDrugName(typed);
    if (!cleaned) return;
    const catalogHit = findCatalogMatch(cleaned);
    onConfirm({
      name: catalogHit?.name ?? cleaned,
      dose: catalogHit?.dose ?? '',
    });
  }

  function rescan() {
    setLabel(null);
    setCapturedPhoto(null);
    setTyped('');
    setStage('camera');
  }

  // Suggestions from DRUG_CATALOG when the user types in fallback mode.
  const matches =
    typed.trim().length >= 2
      ? DRUG_CATALOG.filter((d) =>
          d.name.toLowerCase().includes(typed.trim().toLowerCase()),
        ).slice(0, 5)
      : [];

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="scan-overlay" role="dialog" aria-label="Pill bottle scanner">
      <button className="scan-close" onClick={onClose} type="button">
        Cancel
      </button>

      {/* Viewfinder — the live <video> sits inside the frame on
          camera / reading stages. On review/fallback we swap to the
          captured still. */}
      <div className="scan-frame pill" aria-hidden={stage !== 'camera' && stage !== 'reading'}>
        {(stage === 'camera' || stage === 'reading') && (
          <video
            ref={videoRef}
            className="scan-video"
            playsInline
            muted
            autoPlay
          />
        )}
        {stage === 'reading' && capturedPhoto && (
          <img className="scan-still" src={capturedPhoto} alt="" />
        )}
        {(stage === 'camera' || stage === 'reading') && <div className="scan-sweep" />}
      </div>

      <div className="scan-status">
        {stage === 'reading'
          ? 'Reading label…'
          : status === 'requesting'
          ? 'Opening camera…'
          : status === 'ready'
          ? 'Point at the bottle label'
          : status === 'denied'
          ? 'Camera access needed — type instead'
          : status === 'unsupported'
          ? 'Camera unavailable — type instead'
          : status === 'error'
          ? error ?? 'Camera unavailable'
          : ''}
      </div>

      {/* Shutter — only on the live camera stage. */}
      {stage === 'camera' && (
        <div className="scan-shutter-row">
          <button
            type="button"
            className="scan-shutter"
            onClick={onShutter}
            disabled={status !== 'ready'}
            aria-label="Capture"
          />
        </div>
      )}

      {/* Review — vision returned a drug name (any confidence). */}
      {stage === 'review' && label && (
        <div className="scan-sheet" role="dialog" aria-label="Confirm detected medication">
          <div className="scan-sheet-handle" />
          <div className="scan-sheet-title">
            {label.confidence === 'low' ? 'Best read of your label' : 'Detected from your label'}
          </div>
          <div className="scan-sheet-mbi" style={{ fontSize: 18, letterSpacing: 0 }}>
            {cleanDrugName(label.drugName!)}
            {label.strength ? ` · ${label.strength}` : ''}
          </div>
          {label.directions && (
            <div className="scan-sheet-hint" style={{ marginBottom: 8 }}>
              {label.directions}
            </div>
          )}
          {label.prescriber && (
            <div className="scan-sheet-hint" style={{ marginTop: 0 }}>
              Prescribed by{' '}
              {label.prescriber.startsWith('Dr.') ? label.prescriber : `Dr. ${label.prescriber}`}
            </div>
          )}
          <div className="scan-sheet-hint">
            {label.confidence === 'low'
              ? "We couldn't read it confidently. Confirm or retype."
              : 'Tap confirm to add this to your list.'}
          </div>
          <button className="btn" onClick={confirmFromVision} type="button">
            Confirm &amp; add →
          </button>
          <button
            className="scan-sheet-retry"
            type="button"
            onClick={() => {
              setLabel(null);
              setStage('fallback');
            }}
          >
            Not right — type instead
          </button>
          <button className="scan-sheet-retry" type="button" onClick={rescan}>
            Rescan the bottle
          </button>
        </div>
      )}

      {/* Fallback — vision missed or user opted out. */}
      {stage === 'fallback' && (
        <div className="scan-sheet" role="dialog" aria-label="Type medication name">
          <div className="scan-sheet-handle" />
          <div className="scan-sheet-title">
            {label === null && capturedPhoto ? "Couldn't read label" : 'Type the medication'}
          </div>
          <input
            className="scan-sheet-input"
            placeholder="Medication name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
          />
          {matches.length > 0 && (
            <div className="ac" style={{ marginTop: 6 }}>
              {matches.map((d) => (
                <div
                  key={d.name}
                  className="ac-item"
                  onClick={() => onConfirm({ name: d.name, dose: d.dose })}
                >
                  <div className="ac-name">{d.name}</div>
                  <div className="ac-detail">{d.detail}</div>
                </div>
              ))}
            </div>
          )}
          <button
            className="btn"
            type="button"
            onClick={confirmTyped}
            disabled={typed.trim().length < 2}
            style={{ marginTop: 12 }}
          >
            Add it →
          </button>
          <button className="scan-sheet-retry" type="button" onClick={rescan}>
            Rescan the bottle
          </button>
        </div>
      )}
    </div>
  );
}
