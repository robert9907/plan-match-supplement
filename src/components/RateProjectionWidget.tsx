// React port of the gh-cc-v4 medsupTemplate.js widget.
//
// Renders an interactive Plan G premium projection chart: gender pills,
// age slider (65→95 in 5-year bands), four summary cards, a Chart.js line
// chart with toggleable carrier legend, and an age-band comparison table.
// Data comes from /api/medsup-rates?state=NC (server-side fetch keeps the
// service-role key out of the browser).
//
// Animation/easing constants and the carrier shape match medsupTemplate.js
// so a side-by-side compare against the embed-rendered widget stays clean.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  carrierShortName,
  fetchMedsupCarriers,
  stateLabel,
  type MedsupCarrier,
} from '../lib/medsupRates';
import {
  PROJECTION_AGES,
  avgIncreasePct,
  cheapestAt,
  coverage,
  hasAnyRate,
  lowestTotalBetween,
  pctChangeFromBase,
  rateAt,
  type AgeBand,
  type Gender,
} from '../lib/projectionStats';
import { MedSupRateDisclosure } from './MedSupRateDisclosure';

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

// The bands, the arithmetic and the x-axis all read from one constant so the
// chart can never plot a band the stats do not know about.
const AGES = PROJECTION_AGES;

interface RateProjectionWidgetProps {
  state: string;
  zip: string;
  initialGender: Gender;
  initialAge: number;
}

const fmt = (n: number | null | undefined): string =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString();

function nearestAgeIndex(age: number): number {
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < AGES.length; i++) {
    const d = Math.abs(AGES[i] - age);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  return bestI;
}

// Cubic ease-out animated count. Mirrors the medsupTemplate.js animateNum
// effect so the headline price flows instead of snapping when the slider
// or gender toggle changes.
function useAnimatedNumber(target: number, duration = 500): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const from = fromRef.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * ease);
      setDisplay(next);
      if (p < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        frameRef.current = null;
      }
    };
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      fromRef.current = display;
    };
    // We intentionally re-run only when the target changes; including
    // `display` would interrupt the animation on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

export function RateProjectionWidget({
  state,
  zip,
  initialGender,
  initialAge,
}: RateProjectionWidgetProps) {
  const [carriers, setCarriers] = useState<MedsupCarrier[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gender, setGender] = useState<Gender>(initialGender);
  const [ageIdx, setAgeIdx] = useState<number>(nearestAgeIndex(initialAge));
  const [active, setActive] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCarriers(null);
    setLoadError(null);
    const controller = new AbortController();
    fetchMedsupCarriers(state, controller.signal)
      .then((data) => {
        setCarriers(data);
        setActive(new Set(data.map((c) => c.n)));
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setLoadError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => controller.abort();
  }, [state]);

  const age = AGES[ageIdx] as AgeBand;
  const visible = useMemo(
    () => (carriers ?? []).filter((c) => active.has(c.n)),
    [carriers, active],
  );

  // ── Derived stats ──
  // Every figure below comes from lib/projectionStats, which never turns an
  // absent premium into a number. A null here means "not filed" and renders
  // as an em dash. See that file's header for the $0 defect this replaced.
  const cheapest = useMemo(
    () => cheapestAt(visible, gender, age),
    [visible, gender, age],
  );

  const targetAge = (Math.min(age + 20, 95) as AgeBand);
  const cheapestTarget = useMemo(
    () => cheapestAt(visible, gender, targetAge),
    [visible, gender, targetAge],
  );

  // The window the card actually shows — the applicant's current band through
  // targetAge — not a fixed run from 65. Each band is weighted by its real
  // width in years; see lib/projectionStats for the arithmetic this replaced.
  const lowestTotal = useMemo(
    () => lowestTotalBetween(visible, gender, age, targetAge),
    [visible, gender, age, targetAge],
  );

  const avgIncrease = useMemo(
    () => avgIncreasePct(visible, gender, age, targetAge),
    [visible, gender, age, targetAge],
  );

  // How much of the field this chart actually covers for the selected gender.
  // pm_medsup_rate is ragged, and a curve drawn from part of the market must
  // not read as though it covered all of it.
  const cover = useMemo(
    () => coverage(carriers ?? [], gender),
    [carriers, gender],
  );

  const animatedAmount = useAnimatedNumber(Math.round(cheapest?.p ?? 0));

  // ── Loading / error / empty states ──
  if (loadError) {
    return (
      <div className="gh-ms">
        <div className="ms-fallback">
          <div className="ms-fallback-icon">⚠</div>
          <div className="ms-fallback-title">Couldn't load rates</div>
          <div className="ms-fallback-body">{loadError}</div>
        </div>
      </div>
    );
  }
  if (carriers === null) {
    return (
      <div className="gh-ms">
        <div className="ms-loading">Loading rate data…</div>
      </div>
    );
  }
  if (carriers.length === 0) {
    return (
      <div className="gh-ms">
        <div className="ms-hero">
          <span className="ms-eyebrow">{stateLabel(state)}</span>
          <h2>
            Medicare Supplement Plan G
            <br />
            premium projection
          </h2>
        </div>
        <div className="ms-fallback">
          <div className="ms-fallback-icon">🛠</div>
          <div className="ms-fallback-title">
            Projection chart not available for {stateLabel(state)} yet
          </div>
          {/* Scoped to the CHART, deliberately. This said "we're still
              finalizing carrier rate filings for your state", which reads as
              "we have no rates for you" — and then /results prices 29 plans
              for the same applicant three screens later. Two different
              sources: this chart reads pm_medsup_rate_public (age-banded,
              NC only), while the carrier results read
              pm_supp_carrier_rates_public (the CMS Plan Finder scrape, which
              covers TX and GA). Telling a consumer their state has no rate
              filings while quoting them is the kind of contradiction a
              carrier reviewer asks about. Keep this scoped to the chart. */}
          <div className="ms-fallback-body">
            The 20-year premium projection is only built for North Carolina so far.
            Your {stateLabel(state)} carrier matches and quotes are live — continue below
            to see them.
          </div>
        </div>
      </div>
    );
  }

  // ── Chart config ──
  const chartData = {
    labels: AGES.map(String),
    datasets: carriers.map((c) => {
      const isActive = active.has(c.n);
      return {
        label: c.n,
        data: AGES.map((a) => rateAt(c, gender, a)),
        borderColor: c.c,
        backgroundColor: c.c + '15',
        borderWidth: isActive ? 2.5 : 0,
        pointRadius: AGES.map((a) =>
          isActive && a === age && rateAt(c, gender, a)
            ? 6
            : isActive && rateAt(c, gender, a)
              ? 3
              : 0,
        ),
        pointBackgroundColor: '#fff',
        pointBorderColor: c.c,
        pointBorderWidth: 2,
        hidden: !isActive,
        tension: 0.4,
        // Must stay false. With spanGaps on, a carrier missing the 75/80/85
        // bands got a straight line drawn across them — the chart asserting a
        // premium trajectory the carrier never filed. A gap in the data has to
        // look like a gap.
        spanGaps: false,
        fill: isActive && cheapest !== null && c.n === cheapest.n,
      };
    }),
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(10,22,40,.92)',
        titleFont: { family: 'Inter', size: 12 },
        bodyFont: { family: 'Inter', size: 13 },
        padding: 12,
        cornerRadius: 10,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)}/mo`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { family: 'Inter', size: 12 }, color: '#9CA3AF' },
      },
      y: {
        grid: { color: 'rgba(0,0,0,.04)' },
        ticks: {
          font: { family: 'Inter', size: 11 },
          color: '#9CA3AF',
          callback: (v) => '$' + v,
        },
        border: { display: false },
      },
    },
  };

  const pct = (ageIdx / (AGES.length - 1)) * 100;
  const tableAges = AGES.filter((a) => a >= age);

  const toggleCarrier = (name: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="gh-ms">
      <div className="ms-hero">
        <span className="ms-eyebrow">
          {stateLabel(state)}
          {zip ? ` · ${zip}` : ''}
        </span>
        <h2>
          Medicare Supplement Plan G
          <br />
          premium projection
        </h2>
        <p>
          See exactly how your monthly premium changes as you age — and which carrier saves you the
          most over time.
        </p>
        <div className="ms-stat-label">Lowest available premium</div>
        {/* The headline figure. It renders only when a carrier actually filed
            a premium at this age band for this gender — with no filed rate,
            `animatedAmount` is 0 and this read "$0/mo" under a named carrier. */}
        {cheapest === null ? (
          <>
            <div className="ms-big-stat ms-big-stat-none">
              <span className="ms-amount">—</span>
            </div>
            <div className="ms-stat-carrier">
              No {gender === 'F' ? 'female' : 'male'} premium on file at age {age}
            </div>
          </>
        ) : (
          <>
            <div className="ms-big-stat">
              <span className="ms-dollar">$</span>
              <span className="ms-amount">{animatedAmount}</span>
              <span className="ms-per">/mo</span>
            </div>
            <div className="ms-stat-carrier">
              {carrierShortName(cheapest.n)} · Age {age}
            </div>
          </>
        )}
      </div>

      <div className="ms-controls">
        <div className="ms-ctrl-group">
          <span className="ms-ctrl-label">Gender</span>
          <div className="ms-pill-group">
            <button
              type="button"
              className={`ms-pill${gender === 'M' ? ' ms-active' : ''}`}
              onClick={() => setGender('M')}
            >
              Male
            </button>
            <button
              type="button"
              className={`ms-pill${gender === 'F' ? ' ms-active' : ''}`}
              onClick={() => setGender('F')}
            >
              Female
            </button>
          </div>
        </div>
      </div>

      <div className="ms-slider-wrap">
        <div className="ms-age-display">
          Your age: <strong>{age}</strong>
        </div>
        <input
          type="range"
          className="ms-slider"
          min={0}
          max={AGES.length - 1}
          step={1}
          value={ageIdx}
          onChange={(e) => setAgeIdx(parseInt(e.target.value, 10))}
          style={{ ['--pct' as string]: `${pct}%` } as React.CSSProperties}
        />
        <div className="ms-age-marks">
          {AGES.map((a) => (
            <span key={a}>{a}</span>
          ))}
        </div>
      </div>

      <div className="ms-cards">
        <div className="ms-card">
          <div className="ms-c-label">Lowest at {age}</div>
          <div className="ms-c-val">
            {fmt(cheapest?.p ?? null)}
            <span>/mo</span>
          </div>
          <div className="ms-c-sub" title={cheapest?.n ?? ''}>
            {cheapest ? carrierShortName(cheapest.n) : 'no rate on file'}
          </div>
        </div>
        <div className="ms-card">
          <div className="ms-c-label">Lowest at {targetAge}</div>
          <div className="ms-c-val">
            {fmt(cheapestTarget?.p ?? null)}
            <span>/mo</span>
          </div>
          <div className="ms-c-sub" title={cheapestTarget?.n ?? ''}>
            {cheapestTarget ? carrierShortName(cheapestTarget.n) : 'no rate on file'}
          </div>
        </div>
        <div className="ms-card">
          {/* Only carriers with a premium filed at every band are eligible
              here. A partial sum understates the carrier we know least about
              and would hand it the win. */}
          <div className="ms-c-label">
            Lowest total {age}→{targetAge}
          </div>
          <div className="ms-c-val">{fmt(lowestTotal?.t ?? null)}</div>
          <div className="ms-c-sub" title={lowestTotal?.n ?? ''}>
            {lowestTotal ? carrierShortName(lowestTotal.n) : 'no complete curve on file'}
          </div>
        </div>
        <div className="ms-card">
          <div className="ms-c-label">Avg increase</div>
          <div className="ms-c-val">
            {avgIncrease === null ? '—' : `${avgIncrease}%`}
            <span> over 20yr</span>
          </div>
          <div className="ms-c-sub">
            {age} → {targetAge}
          </div>
        </div>
      </div>

      <div className="ms-legend">
        {carriers.map((c) => {
          const on = active.has(c.n);
          const p = rateAt(c, gender, age);
          // A carrier with nothing filed for this gender is labelled as such
          // rather than rendered bare. Bare reads as cheap, or as a figure
          // that merely happens to be missing from this one age band.
          const none = !hasAnyRate(c, gender);
          const genderWord = gender === 'F' ? 'female' : 'male';
          return (
            <button
              key={c.n}
              type="button"
              className={`ms-leg${on ? ' ms-on' : ''}${none ? ' ms-leg-norate' : ''}`}
              onClick={() => toggleCarrier(c.n)}
              title={none ? `${c.n} — no ${genderWord} rate on file` : c.n}
            >
              <span className="ms-d" style={{ background: c.c }} />
              {carrierShortName(c.n)}
              {none ? ' — no rate on file' : p !== null ? ` ${fmt(p)}` : ''}
            </button>
          );
        })}
      </div>

      <div className="ms-chart-section">
        <div className="ms-chart-wrap">
          <Line data={chartData} options={chartOptions} />
        </div>
        {(cover.partial.length > 0 || cover.missing.length > 0) && (
          <p className="ms-coverage-note">
            {cover.complete.length} of {cover.complete.length + cover.partial.length + cover.missing.length}{' '}
            carriers shown have a {gender === 'F' ? 'female' : 'male'} premium on file at every age band.
            {cover.missing.length > 0 && (
              <> No {gender === 'F' ? 'female' : 'male'} rate is on file for{' '}
              {cover.missing.map(carrierShortName).join(', ')}.</>
            )}
            {cover.partial.length > 0 && (
              <> Rates are on file for only part of the age range for{' '}
              {cover.partial.map(carrierShortName).join(', ')}.</>
            )}{' '}
            Ask Rob for a quote on any carrier shown without a full curve.
          </p>
        )}
      </div>

      <div className="ms-tbl-wrap">
        <table className="ms-tbl">
          <thead>
            <tr>
              <th>Age</th>
              {visible.map((c) => (
                <th key={c.n} title={c.n}>
                  <span className="ms-th-name">{carrierShortName(c.n)}</span>
                </th>
              ))}
              <th className="ms-th-best">Best</th>
            </tr>
          </thead>
          <tbody>
            {tableAges.map((a) => {
              let best: { n: string; p: number } = { n: '—', p: Infinity };
              const cells = visible.map((c) => {
                const p = rateAt(c, gender, a);
                // Was `c[gender][age] || 1`: a carrier with no premium at the
                // applicant's current age had its increase measured against
                // one dollar, rendering figures like "+20,500%".
                const pctChange = pctChangeFromBase(c, gender, age, a);
                if (p !== null && p < best.p) best = { n: c.n, p };
                return (
                  <td key={c.n}>
                    {fmt(p)}
                    {pctChange !== null && (
                      <>
                        {' '}
                        <span className="ms-inc">+{pctChange}%</span>
                      </>
                    )}
                  </td>
                );
              });
              return (
                <tr key={a} className={a === age ? 'ms-current' : ''}>
                  <td style={{ fontWeight: 600 }}>{a}</td>
                  {cells}
                  <td className="ms-cheapest" title={best.n}>
                    {carrierShortName(best.n)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The appointment + not-a-quote disclosure that used to live here now
          renders from RateProjection.tsx. It sat below this widget's success
          branch, so the load-error, loading and zero-carrier returns above all
          dropped it — leaving dollar figures on the page with no disclosure for
          any state without rate rows. Do not re-add it here. */}

      <MedSupRateDisclosure gender={gender === 'F' ? 'female' : 'male'} />
    </div>
  );
}
