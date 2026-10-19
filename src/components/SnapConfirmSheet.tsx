// SnapConfirmSheet — the drop-down sheet after a bottle scan.
//
// Two quick checks before anything is saved: "Is this your pharmacy?"
// (the label's pharmacy, matched to the CMS NPPES registry through the
// shared Plan Match endpoint) and "Is this your doctor?" (the label's
// prescriber, matched to an NPI). Then a "locked down" screen. The
// confirmed pharmacy + doctor ride on each drug to AgentBase. Mirrors
// plan-match/apps/web/src/components/screens/Meds/SnapConfirmSheet.tsx.

import { useEffect, useMemo, useState } from 'react';
import type { BackScanResult, LabelScanResult } from '../hooks/useLabelScan';
import { searchProviders, type ProviderSearchResult } from '../lib/providerSearch';

const PHARMACY_ENDPOINT = 'https://planmatch.generationhealth.me/api/pharmacy-match';

export interface PharmacyDetail {
  npi?: string;
  name: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  mailOrder?: boolean;
  confirmed: boolean;
}

interface PharmacyCandidate {
  npi: string;
  name: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  mailOrder: boolean;
}

export interface SnapItem {
  dataUrl: string;
  label: LabelScanResult;
  back: BackScanResult | null;
}

export interface SnapResult {
  item: SnapItem;
  pharmacy: PharmacyDetail | null;
  /** Doctors the consumer said "yes" to, keyed by the raw label text. */
  doctor: { name: string; npi: string | null; specialty: string | null } | null;
}

type Answer = 'ask' | 'yes' | 'no';

interface Props {
  items: SnapItem[];
  userState: string | null;
  zip: string;
  onCommit: (results: SnapResult[]) => void;
  onAddAnother: () => void;
  onFinish: () => void;
  onTypeInstead: () => void;
}

function normKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function initials(name: string): string {
  const parts = name
    .replace(/^(dr\.?|doctor)\s+/i, '')
    .replace(/,.*$/, '')
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function placeLine(p: { address1?: string | null; city?: string | null }): string {
  return [p.address1, p.city].filter(Boolean).join(', ');
}

function fromCandidate(c: PharmacyCandidate, confirmed: boolean): PharmacyDetail {
  return {
    npi: c.npi,
    name: c.name,
    address1: c.address1 ?? undefined,
    city: c.city ?? undefined,
    state: c.state ?? undefined,
    zip: c.zip ?? undefined,
    phone: c.phone ?? undefined,
    mailOrder: c.mailOrder,
    confirmed,
  };
}

function doctorName(p: ProviderSearchResult): string {
  return p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || '';
}

const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);
const Lock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
);

export function SnapConfirmSheet({ items, userState, zip, onCommit, onAddAnother, onFinish, onTypeInstead }: Props) {
  // ── Pharmacy: the one printed on most of the bottles ────────────────
  const labelPharmacy = useMemo(() => {
    const counts = new Map<string, { n: number; label: LabelScanResult }>();
    for (const it of items) {
      const k = normKey(it.label.pharmacy);
      if (!k) continue;
      const cur = counts.get(k);
      counts.set(k, { n: (cur?.n ?? 0) + 1, label: cur?.label ?? it.label });
    }
    const top = Array.from(counts.values()).sort((a, b) => b.n - a.n)[0]?.label;
    return top?.pharmacy ? top : null;
  }, [items]);

  const [best, setBest] = useState<PharmacyCandidate | null>(null);
  const [matching, setMatching] = useState(false);
  useEffect(() => {
    if (!labelPharmacy) return;
    let cancelled = false;
    setMatching(true);
    const p = new URLSearchParams({ mode: 'match', name: labelPharmacy.pharmacy ?? '' });
    if (labelPharmacy.pharmacyPhone) p.set('phone', labelPharmacy.pharmacyPhone);
    if (labelPharmacy.pharmacyCity) p.set('city', labelPharmacy.pharmacyCity);
    const st = labelPharmacy.pharmacyState || userState;
    if (st) p.set('state', st);
    if (labelPharmacy.pharmacyZip) p.set('zip', labelPharmacy.pharmacyZip);
    fetch(`${PHARMACY_ENDPOINT}?${p.toString()}`)
      .then((r) => r.json())
      .then((b) => !cancelled && setBest((b?.best as PharmacyCandidate | null) ?? null))
      .catch(() => !cancelled && setBest(null))
      .finally(() => !cancelled && setMatching(false));
    return () => {
      cancelled = true;
    };
  }, [labelPharmacy, userState]);

  const [pharmAnswer, setPharmAnswer] = useState<Answer>('ask');
  const [chosen, setChosen] = useState<PharmacyDetail | null>(null);
  const [picker, setPicker] = useState(false);

  const shownPharmacy: PharmacyDetail | null = chosen
    ? chosen
    : best
    ? fromCandidate(best, false)
    : labelPharmacy
    ? {
        name: titleCase(labelPharmacy.pharmacy ?? ''),
        address1: labelPharmacy.pharmacyAddress ?? undefined,
        city: labelPharmacy.pharmacyCity ?? undefined,
        state: labelPharmacy.pharmacyState ?? undefined,
        zip: labelPharmacy.pharmacyZip ?? undefined,
        phone: labelPharmacy.pharmacyPhone ?? undefined,
        confirmed: false,
      }
    : null;

  // ── Doctors: one card per prescriber printed on the labels ──────────
  const prescribers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) {
      const raw = it.label.prescriber?.trim();
      if (raw && !seen.has(normKey(raw))) seen.set(normKey(raw), raw);
    }
    return Array.from(seen.values()).slice(0, 3);
  }, [items]);
  const [docMatches, setDocMatches] = useState<Record<string, ProviderSearchResult | null>>({});
  const [docAnswers, setDocAnswers] = useState<Record<string, Answer>>({});
  useEffect(() => {
    let cancelled = false;
    for (const raw of prescribers) {
      const q = raw.replace(/^(?:Dr\.?|Doctor)\s+/i, '').replace(/,.*$/, '').trim();
      void searchProviders(q, userState, undefined, 1)
        .then((rows) => !cancelled && setDocMatches((p) => ({ ...p, [raw]: rows[0] ?? null })))
        .catch(() => !cancelled && setDocMatches((p) => ({ ...p, [raw]: null })));
    }
    return () => {
      cancelled = true;
    };
  }, [prescribers, userState]);

  const [done, setDone] = useState(false);
  const ready = pharmAnswer !== 'ask' && prescribers.every((p) => (docAnswers[p] ?? 'ask') !== 'ask');

  function commit() {
    const confirmed = pharmAnswer === 'yes' ? chosen ?? shownPharmacy : null;
    const askedKey = normKey(labelPharmacy?.pharmacy);
    const results: SnapResult[] = items.map((item) => {
      const ownKey = normKey(item.label.pharmacy);
      let pharmacy: PharmacyDetail | null = null;
      if (confirmed && (!ownKey || ownKey === askedKey)) pharmacy = confirmed;
      else if (item.label.pharmacy) {
        pharmacy = {
          name: titleCase(item.label.pharmacy),
          phone: item.label.pharmacyPhone ?? undefined,
          address1: item.label.pharmacyAddress ?? undefined,
          city: item.label.pharmacyCity ?? undefined,
          state: item.label.pharmacyState ?? undefined,
          zip: item.label.pharmacyZip ?? undefined,
          confirmed: false,
        };
      }
      const raw = item.label.prescriber?.trim() ?? '';
      const m = raw ? docMatches[raw] : null;
      const doctor =
        raw && docAnswers[raw] === 'yes'
          ? {
              name: m ? doctorName(m) || raw : raw,
              npi: m?.npi ?? null,
              specialty: m?.specialty_display ?? m?.specialty ?? null,
            }
          : null;
      return { item, pharmacy, doctor };
    });
    onCommit(results);
    setDone(true);
  }

  // ── Locked down ─────────────────────────────────────────────────────
  if (done) {
    const rows = [
      ...items.map((it) => ({
        kind: 'Medicine',
        value: `${titleCase(it.label.drugName ?? '')}${it.label.strength ? ` ${it.label.strength}` : ''}`,
      })),
      ...(pharmAnswer === 'yes' && shownPharmacy ? [{ kind: 'Pharmacy', value: (chosen ?? shownPharmacy).name }] : []),
      ...prescribers
        .filter((p) => docAnswers[p] === 'yes')
        .map((p) => ({ kind: 'Doctor', value: (docMatches[p] && doctorName(docMatches[p]!)) || p })),
    ];
    return (
      <div className="snap-top-sheet snap-done" role="dialog" aria-label="Saved">
        <svg className="snap-done-check" width="104" height="104" viewBox="0 0 112 112" role="img" aria-label="All set">
          <circle cx="56" cy="56" r="48" className="snap-ring-bg" />
          <circle cx="56" cy="56" r="48" className="snap-ring" transform="rotate(-90 56 56)" />
          <path d="M36 57l13 13 27-29" className="snap-tick" />
        </svg>
        <div className="snap-done-title">You’re all set</div>
        <div className="snap-done-sub">We’ll keep these on file with your application.</div>
        <div className="snap-card snap-done-list">
          {rows.map((r, i) => (
            <div key={`${r.kind}-${i}`} className="snap-done-row">
              <span className="snap-done-dot"><Check /></span>
              <div>
                <div className="snap-eyebrow">{r.kind}</div>
                <div className="snap-done-value">{r.value}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="snap-lock">
          <div className="snap-lock-flow">
            <span className="snap-lock-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
            </span>
            <span className="snap-lock-track"><span className="snap-lock-pulse" /></span>
            <span className="snap-lock-vault" aria-hidden="true"><Lock /></span>
          </div>
          <div className="snap-lock-title">Your information is on lockdown</div>
          <div className="snap-lock-sub">Encrypted the moment it leaves your phone. The photo is deleted once it’s saved.</div>
          <div className="snap-lock-tags">
            <span>Encrypted</span>
            <span>Photo deleted</span>
          </div>
        </div>
        <button type="button" className="snap-btn snap-btn-xl" onClick={onAddAnother}>Add another medicine</button>
        <button type="button" className="scan-sheet-retry" onClick={onFinish}>I’m done — see my list</button>
      </div>
    );
  }

  if (picker) {
    return (
      <PharmacyPicker
        zip={zip || best?.zip || labelPharmacy?.pharmacyZip || ''}
        userState={userState ?? best?.state ?? labelPharmacy?.pharmacyState ?? null}
        labelName={labelPharmacy?.pharmacy ?? null}
        onBack={() => setPicker(false)}
        onPick={(p) => {
          setChosen(p);
          setPharmAnswer('yes');
          setPicker(false);
        }}
      />
    );
  }

  // ── The drop-down sheet ─────────────────────────────────────────────
  const first = items[0];
  const medTitle =
    items.length === 1
      ? `${titleCase(first.label.drugName ?? '')}${first.label.strength ? ` ${first.label.strength}` : ''}`
      : `${items.length} medicines`;
  const medSub =
    items.length === 1
      ? [first.label.directions, first.back?.quantity ? `Qty ${first.back.quantity}` : null].filter(Boolean).join(' · ')
      : items.map((it) => titleCase(it.label.drugName ?? '')).join(', ');

  return (
    <div className="snap-top-sheet" role="dialog" aria-label="Confirm pharmacy and doctor">
      <div className="snap-med">
        <div className="snap-med-thumb">{first?.dataUrl ? <img src={first.dataUrl} alt="" /> : null}</div>
        <div className="snap-med-body">
          <div className="snap-read"><Check /> Read from your label</div>
          <div className="snap-med-title">{medTitle}</div>
          {medSub && <div className="snap-med-sub">{medSub}</div>}
        </div>
      </div>

      <div className="snap-h">{prescribers.length > 0 ? 'Just two quick checks' : 'One quick check'}</div>

      <div className="snap-card">
        <div className="snap-eyebrow">{shownPharmacy ? 'IS THIS YOUR PHARMACY?' : 'WHERE DO YOU PICK UP YOUR MEDICINE?'}</div>
        {shownPharmacy ? (
          <>
            <div className="snap-name">{shownPharmacy.name}</div>
            {placeLine(shownPharmacy) && <div className="snap-sub">{placeLine(shownPharmacy)}</div>}
            <div className="snap-tags">
              {matching && !chosen && <span className="snap-tag snap-tag-blue">Checking the national pharmacy list…</span>}
              {shownPharmacy.npi && <span className="snap-tag snap-tag-green">Matched to the national pharmacy list</span>}
              {shownPharmacy.mailOrder && <span className="snap-tag snap-tag-blue">Mail order</span>}
            </div>
          </>
        ) : (
          <div className="snap-sub">We couldn’t read a pharmacy on the label.</div>
        )}
        {pharmAnswer === 'ask' ? (
          <div className="snap-actions">
            {shownPharmacy ? (
              <button type="button" className="snap-btn" onClick={() => { setChosen({ ...shownPharmacy, confirmed: true }); setPharmAnswer('yes'); }}>
                Yes, that’s mine
              </button>
            ) : (
              <button type="button" className="snap-btn" onClick={() => setPicker(true)}>Choose my pharmacy</button>
            )}
            <button type="button" className="snap-btn snap-btn-soft" onClick={() => (shownPharmacy ? setPicker(true) : setPharmAnswer('no'))}>
              {shownPharmacy ? 'Change' : 'Skip'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={['snap-saved', pharmAnswer === 'no' ? 'snap-saved-muted' : ''].filter(Boolean).join(' ')}
            onClick={() => { setPharmAnswer('ask'); setChosen(null); }}
          >
            {pharmAnswer === 'yes' ? (<><Check /> Pharmacy saved</>) : 'Skipped — tap to choose'}
          </button>
        )}
      </div>

      {prescribers.map((raw) => {
        const m = docMatches[raw];
        const loading = !(raw in docMatches);
        const name = (m && doctorName(m)) || raw;
        const ans = docAnswers[raw] ?? 'ask';
        const place = m ? [m.specialty_display ?? m.specialty, m.practice_city].filter(Boolean).join(' · ') : '';
        return (
          <div className="snap-card" key={raw}>
            <div className="snap-eyebrow">IS THIS YOUR DOCTOR?</div>
            <div className="snap-doc">
              <span className="snap-avatar">{initials(name)}</span>
              <div>
                <div className="snap-name">{name}</div>
                {place && <div className="snap-sub">{place}</div>}
              </div>
            </div>
            <div className="snap-tags">
              {loading && <span className="snap-tag snap-tag-blue">Checking the national doctor list…</span>}
              {m && <span className="snap-tag snap-tag-green"><Lock /> Verified licensed provider</span>}
            </div>
            {ans === 'ask' ? (
              <div className="snap-actions">
                <button type="button" className="snap-btn" onClick={() => setDocAnswers((p) => ({ ...p, [raw]: 'yes' }))}>Yes, that’s my doctor</button>
                <button type="button" className="snap-btn snap-btn-soft" onClick={() => setDocAnswers((p) => ({ ...p, [raw]: 'no' }))}>Not my doctor</button>
              </div>
            ) : (
              <button
                type="button"
                className={['snap-saved', ans === 'no' ? 'snap-saved-muted' : ''].filter(Boolean).join(' ')}
                onClick={() => setDocAnswers((p) => ({ ...p, [raw]: 'ask' }))}
              >
                {ans === 'yes' ? (<><Check /> Doctor saved</>) : 'Got it — you can add your doctor next'}
              </button>
            )}
          </div>
        );
      })}

      {ready && (
        <button type="button" className="snap-btn snap-btn-go" onClick={commit}>Continue</button>
      )}

      <div className="snap-private"><Lock /> Shared only with your licensed agent</div>
      <button type="button" className="scan-sheet-retry" onClick={onTypeInstead}>Medicine not right? Type it</button>
      <span className="snap-grabber" aria-hidden="true" />
    </div>
  );
}

function PharmacyPicker({
  zip,
  userState,
  labelName,
  onBack,
  onPick,
}: {
  zip: string;
  userState: string | null;
  labelName: string | null;
  onBack: () => void;
  onPick: (p: PharmacyDetail) => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'near' | 'mail'>('near');
  const [rows, setRows] = useState<PharmacyCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const z = zip.replace(/\D/g, '').slice(0, 5);
  const needsZip = z.length !== 5;

  useEffect(() => {
    if (mode !== 'near') return;
    const q = query.trim();
    if (needsZip && !(q.length >= 2 && userState)) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      const p = new URLSearchParams({ mode: 'list' });
      if (q.length >= 2) p.set('q', q);
      else p.set('zip', z);
      if (userState) p.set('state', userState);
      fetch(`${PHARMACY_ENDPOINT}?${p.toString()}`)
        .then((r) => r.json())
        .then((b) => !cancelled && setRows(Array.isArray(b?.candidates) ? b.candidates : []))
        .catch(() => !cancelled && setRows([]))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [mode, query, z, needsZip, userState]);

  const labelKey = normKey(labelName);

  return (
    <div className="snap-top-sheet" role="dialog" aria-label="Choose pharmacy">
      <button type="button" className="snap-back" onClick={onBack}>← Back</button>
      <div className="snap-picker-title">Where do you pick up your medicine?</div>
      <div className="snap-seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'near'} className={mode === 'near' ? 'on' : ''} onClick={() => setMode('near')}>Near me</button>
        <button type="button" role="tab" aria-selected={mode === 'mail'} className={mode === 'mail' ? 'on' : ''} onClick={() => setMode('mail')}>Mail order</button>
      </div>
      {mode === 'near' ? (
        <>
          <label className="snap-search">
            <span className="sr-only">Search pharmacies</span>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Pharmacy name" autoComplete="off" />
          </label>
          {needsZip && query.trim().length < 2 && <div className="snap-sub">Type your pharmacy’s name to find it.</div>}
          <div className="snap-card snap-list">
            {loading && rows.length === 0 && <div className="snap-list-empty">Searching…</div>}
            {!loading && rows.length === 0 && !needsZip && <div className="snap-list-empty">No pharmacies found. Try typing the name.</div>}
            {rows.map((r) => (
              <button key={r.npi} type="button" className="snap-list-row" onClick={() => onPick(fromCandidate(r, true))}>
                <div className="snap-list-main">
                  <div className="snap-list-name">{r.name}</div>
                  <div className="snap-sub">{placeLine(r)}</div>
                </div>
                {labelKey && normKey(r.name).includes(labelKey.slice(0, 8)) && <span className="snap-tag snap-tag-green">On label</span>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="snap-mail">
          <div className="snap-eyebrow snap-eyebrow-gold">MAIL ORDER</div>
          <div className="snap-mail-title">Get a 90-day supply delivered to your door</div>
          <button type="button" className="snap-btn snap-btn-go" onClick={() => onPick({ name: 'Mail order pharmacy', mailOrder: true, confirmed: true })}>
            I use mail order
          </button>
        </div>
      )}
    </div>
  );
}
