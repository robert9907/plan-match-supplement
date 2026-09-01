import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useCameraStream } from '../hooks/useCameraStream';
import { useLabelScan, type LabelScanResult } from '../hooks/useLabelScan';
import {
  drugDisplayDetail,
  drugDisplayName,
  searchDrugs,
  type DrugSearchResult,
  MIN_SEARCH_CHARS,
} from '../lib/drugSearch';

const SEARCH_DEBOUNCE_MS = 200;

// ─── Helpers ──────────────────────────────────────────────────────

// Strip strength tokens + trailing brackets, then title-case. The OCR
// result for "Gabapentin 300 MG Cap" should display as "Gabapentin".
// Long edge cap for uploaded photos. A recent phone shoots 4000px+; past
// ~1600 the vision model gains nothing and the base64 payload triples.
const MAX_UPLOAD_EDGE = 1600;

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

type Stage = 'capturing' | 'review' | 'fallback';

const CREDENTIAL_SUFFIX =
  /(?:^|[\s,])(?:M\.?D|D\.?O|N\.?P|P\.?A(?:-C)?|D\.?D\.?S|D\.?P\.?M|O\.?D|PharmD|APRN|CRNA|FNP|DNP|RN)\.?\s*$/i;

/** Prescriber names come off a label in every shape: "MARCUS T.
 *  ELLINGTON, MD", "Dr. Priya Raghavan", "J. Chen-Okafor NP". Only
 *  prepend "Dr." when the name carries no credential of its own —
 *  otherwise the review card reads "Dr. Marcus T. Ellington, MD". */
export function formatPrescriber(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return '';
  if (/^(?:dr\.?|doctor)\s/i.test(name)) return name;
  if (CREDENTIAL_SUFFIX.test(name)) return name;
  return `Dr. ${name}`;
}

interface ScanQueueItem {
  id: string;
  dataUrl: string;
  status: 'pending' | 'success' | 'error';
  label: LabelScanResult | null;
  error: string | null;
  // Per-row include/exclude toggle for the review stage. Defaults true
  // on success rows; the user can uncheck a misread before Add All.
  selected: boolean;
}

export interface ScannedDrug {
  name: string;
  dose: string;
  /** Prescriber as printed on the label, normalised for display.
   *  Empty string when the label carried none. */
  prescriber: string;
  /** NPI when the vision call managed to read one. Labels almost
   *  never print it, so this is usually null. */
  prescriberNpi: string | null;
  /** Dispensing pharmacy — kept for the client file, not scored. */
  pharmacy: string;
}

interface Props {
  /** Called once with every drug the user confirmed — single bottle
   *  scans pass a single-element array, multi-bottle pass N. Parent
   *  runs classifyMed + addMed, records any prescriber via addProvider,
   *  and is responsible for calling onClose afterwards. */
  onConfirm: (drugs: ScannedDrug[]) => void;
  onClose: () => void;
}

function labelToDrug(label: LabelScanResult): ScannedDrug | null {
  if (!label.drugName) return null;
  return {
    name: cleanDrugName(label.drugName),
    dose: label.strength ?? '',
    prescriber: label.prescriber ? formatPrescriber(label.prescriber) : '',
    prescriberNpi: label.prescriberNpi,
    pharmacy: label.pharmacy ?? '',
  };
}

/** Paths that never touch a label — the typed fallback and the
 *  library picker — have no prescriber to report. */
function typedDrug(name: string, dose: string): ScannedDrug {
  return { name, dose, prescriber: '', prescriberNpi: null, pharmacy: '' };
}

export function PillScanSheet({ onConfirm, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('capturing');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [queue, setQueue] = useState<ScanQueueItem[]>([]);
  const [flash, setFlash] = useState(false);
  const [typed, setTyped] = useState('');
  const [matches, setMatches] = useState<DrugSearchResult[]>([]);
  const idCounter = useRef(0);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const cameraActive = stage === 'capturing';
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

  function updateItem(id: string, patch: Partial<Omit<ScanQueueItem, 'id'>>) {
    setQueue((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function fireScan(id: string, dataUrl: string) {
    void scan(dataUrl)
      .then((res) => {
        if (res.label && res.label.drugName) {
          updateItem(id, {
            status: 'success',
            label: res.label,
            error: null,
            selected: true,
          });
        } else {
          updateItem(id, {
            status: 'error',
            label: res.label,
            error: 'No label detected',
            selected: false,
          });
        }
      })
      .catch((err: unknown) => {
        updateItem(id, {
          status: 'error',
          label: null,
          error: err instanceof Error ? err.message : 'Scan failed',
          selected: false,
        });
      });
  }

  // Upload path for when the camera never opens — permission denied, no
  // camera on the device, or a desktop browser. Without this the scanner
  // dropped straight to typing a drug name, so a photo you already had
  // was unusable.
  async function fileToDataUrl(file: File): Promise<string> {
    const raw = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Could not open that image'));
        el.src = raw;
      });
      const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
      if (!longEdge || longEdge <= MAX_UPLOAD_EDGE) return raw;
      const scale = MAX_UPLOAD_EDGE / longEdge;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return raw;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    } catch {
      // HEIC and friends may not decode into a canvas. Send the original
      // and let the server decide.
      return raw;
    }
  }

  async function onUploadPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const id = `scan-${Date.now()}-${idCounter.current++}`;
      setQueue((prev) => [
        ...prev,
        { id, dataUrl, status: 'pending', label: null, error: null, selected: false },
      ]);
      const res = await scan(dataUrl);
      if (res.label?.drugName) {
        updateItem(id, { status: 'success', label: res.label, error: null, selected: true });
        setStage('review');
      } else {
        updateItem(id, {
          status: 'error',
          label: res.label,
          error: 'No label detected',
          selected: false,
        });
      }
    } catch {
      // Stay on the fallback sheet; typing still works.
    } finally {
      setUploadBusy(false);
    }
  }

  function onShutter() {
    if (status !== 'ready') return;
    const dataUrl = capture();
    if (!dataUrl) return;
    setFlash(true);
    window.setTimeout(() => setFlash(false), 220);
    const id = `scan-${Date.now()}-${idCounter.current++}`;
    setQueue((prev) => [
      ...prev,
      {
        id,
        dataUrl,
        status: 'pending',
        label: null,
        error: null,
        selected: false,
      },
    ]);
    fireScan(id, dataUrl);
  }

  function onDone() {
    stop();
    // Single capture → keep the existing single-card review so a one-
    // bottle scan still works exactly as before.
    if (queue.length === 1) {
      const only = queue[0];
      if (only.status === 'success' && only.label?.drugName) {
        setStage('review');
      } else {
        setStage('fallback');
      }
      return;
    }
    setStage('review');
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((it) => it.id !== id));
  }

  function retryItem(item: ScanQueueItem) {
    updateItem(item.id, { status: 'pending', error: null });
    fireScan(item.id, item.dataUrl);
  }

  function toggleSelected(id: string) {
    setQueue((prev) =>
      prev.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it)),
    );
  }

  function confirmFromQueue() {
    const drugs = queue
      .filter((it) => it.selected && it.status === 'success' && it.label?.drugName)
      .map((it) => labelToDrug(it.label!))
      .filter((d): d is ScannedDrug => Boolean(d));
    if (drugs.length === 0) return;
    onConfirm(drugs);
  }

  function confirmTyped() {
    const cleaned = cleanDrugName(typed);
    if (!cleaned) return;
    onConfirm([typedDrug(cleaned, '')]);
  }

  function rescan() {
    setQueue([]);
    setTyped('');
    setMatches([]);
    setStage('capturing');
  }

  // Debounced lookup against the shared library API for the fallback
  // typing path. Same pattern as Meds.tsx — abort on query change so a
  // slow response can't overwrite newer matches.
  useEffect(() => {
    const q = typed.trim();
    if (q.length < MIN_SEARCH_CHARS) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      searchDrugs(q, controller.signal, 5)
        .then((drugs) => setMatches(drugs))
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [typed]);

  const total = queue.length;
  const successCount = queue.filter((it) => it.status === 'success').length;
  const pendingCount = queue.filter((it) => it.status === 'pending').length;
  const selectedCount = queue.filter((it) => it.selected).length;

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="scan-overlay" role="dialog" aria-label="Pill bottle scanner">
      <button className="scan-close" onClick={onClose} type="button">
        Cancel
      </button>

      {/* Viewfinder — live <video> on capturing stage; sits behind the
          flash overlay so a capture confirmation reads even on dark
          labels. */}
      <div className="scan-frame pill" aria-hidden={stage !== 'capturing'}>
        {stage === 'capturing' && (
          <>
            <video
              ref={videoRef}
              className="scan-video"
              playsInline
              muted
              autoPlay
            />
            <div className="scan-sweep" />
            <div className={['scan-capture-flash', flash ? 'flash' : ''].filter(Boolean).join(' ')} />
          </>
        )}
      </div>

      <div className="scan-status">
        {stage === 'capturing' && status === 'requesting' && 'Opening camera…'}
        {stage === 'capturing' && status === 'ready' && (
          total === 0
            ? 'Point at the bottle label'
            : `${total} bottle${total === 1 ? '' : 's'} scanned · keep going`
        )}
        {stage === 'capturing' && status === 'denied' && 'Camera access needed — type instead'}
        {stage === 'capturing' && status === 'unsupported' && 'Camera unavailable — type instead'}
        {stage === 'capturing' && status === 'error' && (error ?? 'Camera unavailable')}
      </div>

      {/* Thumbnail strip + Done button — visible during capturing once
          there's at least one scanned bottle in the queue. */}
      {stage === 'capturing' && total > 0 && (
        <div className="scan-queue">
          <div className="scan-queue-head">
            <span className="scan-queue-count">
              {total} bottle{total === 1 ? '' : 's'} scanned
              {pendingCount > 0
                ? ' · reading…'
                : successCount < total
                ? ` · ${successCount} read`
                : ''}
            </span>
            <button
              type="button"
              className="scan-done-btn"
              onClick={onDone}
              disabled={total === 0}
            >
              Done scanning →
            </button>
          </div>
          <div className="scan-strip" role="list">
            {queue.map((it) => (
              <div
                key={it.id}
                role="listitem"
                className={`scan-thumb scan-thumb-${it.status}`}
                onClick={() => {
                  if (it.status === 'error') retryItem(it);
                }}
                title={
                  it.status === 'success'
                    ? cleanDrugName(it.label?.drugName ?? 'Read')
                    : it.status === 'error'
                    ? it.error ?? 'Tap to retry'
                    : 'Reading…'
                }
              >
                <img src={it.dataUrl} alt="" />
                <div className="scan-thumb-overlay">
                  {it.status === 'pending' && <span className="scan-thumb-spinner" />}
                  {it.status === 'success' && (
                    <>
                      <span className="scan-thumb-badge scan-thumb-badge-ok">✓</span>
                      <span className="scan-thumb-name">
                        {cleanDrugName(it.label?.drugName ?? 'Read')}
                      </span>
                    </>
                  )}
                  {it.status === 'error' && (
                    <>
                      <span className="scan-thumb-badge scan-thumb-badge-err">×</span>
                      <span className="scan-thumb-name">Tap to retry</span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className="scan-thumb-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue(it.id);
                  }}
                  aria-label="Remove this capture"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shutter — only on the live capturing stage. */}
      {stage === 'capturing' && (
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

      {/* Review — single-bottle (legacy single card). Used when the user
          tapped Done after one capture and OCR resolved with a label. */}
      {stage === 'review' && queue.length === 1 && queue[0].label?.drugName && (
        <div className="scan-sheet" role="dialog" aria-label="Confirm detected medication">
          <div className="scan-sheet-handle" />
          <div className="scan-sheet-title">
            {queue[0].label.confidence === 'low'
              ? 'Best read of your label'
              : 'Detected from your label'}
          </div>
          <div className="scan-sheet-mbi" style={{ fontSize: 18, letterSpacing: 0 }}>
            {cleanDrugName(queue[0].label.drugName)}
            {queue[0].label.strength ? ` · ${queue[0].label.strength}` : ''}
          </div>
          {queue[0].label.directions && (
            <div className="scan-sheet-hint" style={{ marginBottom: 8 }}>
              {queue[0].label.directions}
            </div>
          )}
          {queue[0].label.prescriber && (
            <div className="scan-sheet-hint" style={{ marginTop: 0 }}>
              Prescribed by {formatPrescriber(queue[0].label.prescriber)}
            </div>
          )}
          <div className="scan-sheet-hint">
            {queue[0].label.confidence === 'low'
              ? "We couldn't read it confidently. Confirm or retype."
              : 'Tap confirm to add this to your list.'}
          </div>
          <button className="btn" onClick={confirmFromQueue} type="button">
            Confirm &amp; add →
          </button>
          <button
            className="scan-sheet-retry"
            type="button"
            onClick={() => setStage('fallback')}
          >
            Not right — type instead
          </button>
          <button className="scan-sheet-retry" type="button" onClick={rescan}>
            Rescan the bottle
          </button>
        </div>
      )}

      {/* Review — multi-bottle list with checkboxes. */}
      {stage === 'review' && queue.length >= 2 && (
        <div className="scan-sheet" role="dialog" aria-label="Confirm detected medications">
          <div className="scan-sheet-handle" />
          <div className="scan-sheet-title">
            {total} bottle{total === 1 ? '' : 's'} scanned
          </div>
          <div className="scan-multi-list" role="list">
            {queue.map((it) => {
              const display = it.label?.drugName ? cleanDrugName(it.label.drugName) : null;
              return (
                <div
                  key={it.id}
                  role="listitem"
                  className={[
                    'scan-multi-row',
                    `scan-multi-row-${it.status}`,
                    it.selected ? 'scan-multi-row-on' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <label className="scan-multi-checkbox">
                    <input
                      type="checkbox"
                      checked={it.selected}
                      disabled={it.status !== 'success'}
                      onChange={() => toggleSelected(it.id)}
                      aria-label={display ? `Add ${display}` : 'Pending capture'}
                    />
                    <span className="scan-multi-checkbox-box" aria-hidden />
                  </label>
                  <img className="scan-multi-thumb" src={it.dataUrl} alt="" />
                  <div className="scan-multi-body">
                    {it.status === 'success' && display && (
                      <>
                        <div className="scan-multi-name">
                          {display}
                          {it.label?.strength ? ` · ${it.label.strength}` : ''}
                        </div>
                        {it.label?.directions && (
                          <div className="scan-multi-detail">{it.label.directions}</div>
                        )}
                        {it.label?.prescriber && (
                          <div className="scan-multi-detail">
                            {formatPrescriber(it.label.prescriber)}
                          </div>
                        )}
                      </>
                    )}
                    {it.status === 'pending' && (
                      <div className="scan-multi-name muted">Reading label…</div>
                    )}
                    {it.status === 'error' && (
                      <div className="scan-multi-name" style={{ color: '#b42318' }}>
                        Couldn't read this label
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button
            className="btn"
            onClick={confirmFromQueue}
            disabled={selectedCount === 0 || pendingCount > 0}
            type="button"
          >
            {pendingCount > 0
              ? `Reading ${pendingCount}…`
              : `Add ${selectedCount} medication${selectedCount === 1 ? '' : 's'} →`}
          </button>
          <button className="scan-sheet-retry" type="button" onClick={rescan}>
            Rescan
          </button>
        </div>
      )}

      {/* Fallback — vision missed or user opted out. */}
      {stage === 'fallback' && (
        <div className="scan-sheet" role="dialog" aria-label="Type medication name">
          <div className="scan-sheet-handle" />
          <div className="scan-sheet-title">
            {queue.length > 0 && successCount === 0 ? "Couldn't read label" : 'Type the medication'}
          </div>
          {/* Deliberately no capture attribute — this path exists because
              the camera is unavailable, so it must open the photo library. */}
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onUploadPick}
          />
          <button
            className="scan-sheet-retry"
            type="button"
            disabled={uploadBusy}
            onClick={() => uploadInputRef.current?.click()}
          >
            {uploadBusy ? 'Reading your photo…' : 'Upload a photo of the label'}
          </button>
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
                  key={d.rxcui}
                  className="ac-item"
                  onClick={() =>
                    onConfirm([typedDrug(drugDisplayName(d), d.strength)])
                  }
                >
                  <div className="ac-name">{drugDisplayName(d)}</div>
                  <div className="ac-detail">{drugDisplayDetail(d)}</div>
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
