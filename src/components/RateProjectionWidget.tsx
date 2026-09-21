// React port of the gh-cc-v4 medsupTemplate.js widget.
//
// Renders an interactive Plan G premium projection chart: gender pills,
// age slider (65→95 in 5-year bands), four summary cards, a Chart.js line
// chart, a ranked carrier list and an age-band comparison table.
//
// The chart is an EMPHASIS chart, not a multi-series categorical one. Every
// carrier is drawn; up to five pinned ones take a series hue and the rest stay
// as context lines. A line chart stops being readable somewhere around eight
// coloured series, and the board is already past that — so the ranked list,
// not the palette, is what carries identity. Do not "fix" this by generating
// more hues: a generated hue is indistinguishable from an existing one under
// colour-vision deficiency. Fold, facet or rank instead.
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
  totalBetween,
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

// Emphasis palette. Slot 1 is the brand seafoam (--seafoam #83f0f9) stepped
// down its own OKLCH hue (202.5) to L 0.60 — the brand value itself measures
// 1.29:1 on a white card and cannot carry a line. Validated as an ordered set
// against the white card surface: worst adjacent CVD deltaE 13.6 (protan,
// target 8.0), worst normal-vision deltaE 28.3 (floor 15). Slot 4 is the one
// below 3:1, so it sits behind the three default pins and its relief is the
// always-visible ranked list plus the table. Re-run the palette validator
// before touching these or their order.
const SERIES = ['#00929b', '#eb6834', '#4a3aa7', '#eda100', '#008300'];
const CONTEXT = '#cfcec7';
const MAX_PINS = 5;

interface RateProjectionWidgetProps {
  state: string;
  zip: string;
  initialGender: Gender;
  initialAge: number;
}

const fmt = (n: number | null | undefined): string =>
  n == null ? '—' : '$' + Math.round(n).toLocaleString();

// pm_medsup_carrier.rating_type is a database enum — 'attained_age',
// 'issue_age', 'community' — and it was reaching the consumer table raw,
// underscores and all. These three labels are the exact terms the rate
// disclosure below the table uses to explain each method, so the column
// and its explanation read as one thing. An unrecognised value shows an
// em dash rather than being guessed at: which method sets a premium is a
// rate representation, and a wrong one is worse than none.
const RATE_TYPE_LABEL: Record<string, string> = {
  attained_age: 'Attained-age',
  issue_age: 'Issue-age',
  community: 'Community-rated',
};

const rateTypeLabel = (ra: string | null | undefined): string =>
  (ra ? RATE_TYPE_LABEL[ra.trim().toLowerCase()] : undefined) ?? '—';

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
  // Pinned carriers are drawn in a series hue; everything else stays on the
  // chart as a context line. This is emphasis, not filtering — see `visible`.
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    setCarriers(null);
    setLoadError(null);
    const controller = new AbortController();
    fetchMedsupCarriers(state, controller.signal)
      .then((data) => {
        setCarriers(data);
        setPinned([]);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setLoadError(err instanceof Error ? err.message : 'Unknown error');
      });
    return () => controller.abort();
  }, [state]);

  const age = AGES[ageIdx] as AgeBand;
  // Every figure below reads the whole filed field, not the selection. When
  // this filtered on the legend, un-toggling a carrier moved the headline
  // "lowest available premium" — the page reported a different cheapest rate
  // depending on which chips happened to be on.
  const visible = useMemo(() => carriers ?? [], [carriers]);

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

  // Cheapest-first over the same window the cards describe. `totalBetween`
  // returns null for a carrier missing any band in that window, so a ragged
  // carrier sorts to the end rather than winning on a partial sum.
  const ranked = useMemo(
    () =>
      visible
        .map((c) => ({ c, t: totalBetween(c, gender, age, targetAge) }))
        .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity)),
    [visible, gender, age, targetAge],
  );

  // Seed the pins with cheapest / middle / dearest of the carriers that have a
  // complete curve. Pinning the three cheapest stacks three near-identical
  // lines on top of each other and shows nothing; spanning the field is what
  // makes the spread legible. Seeds once per state — it must not yank the
  // user's picks when they move the slider or flip gender.
  const seeded = useRef(false);
  useEffect(() => {
    seeded.current = false;
  }, [state]);
  useEffect(() => {
    if (seeded.current) return;
    const full = ranked.filter((r) => r.t !== null);
    if (full.length === 0) return;
    seeded.current = true;
    const idx = [0, Math.floor((full.length - 1) / 2), full.length - 1];
    setPinned([...new Set(idx.map((i) => full[i].c.n))]);
  }, [ranked]);

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
            The 20-year premium projection is built for North Carolina, Texas and Georgia
            so far.
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
      // Unpinned carriers stay on the chart in the context gray instead of
      // being hidden. The field is the point: a pinned line only means
      // something against the spread it sits in. `order` keeps the pinned
      // lines drawn above the context band.
      const pi = pinned.indexOf(c.n);
      const on = pi >= 0;
      const col = on ? SERIES[pi % SERIES.length] : CONTEXT;
      return {
        label: c.n,
        data: AGES.map((a) => rateAt(c, gender, a)),
        borderColor: col,
        backgroundColor: col + '15',
        borderWidth: on ? 2.5 : 1.25,
        order: on ? 0 : 1,
        pointRadius: AGES.map((a) =>
          on && a === age && rateAt(c, gender, a)
            ? 6
            : on && rateAt(c, gender, a)
              ? 3
              : 0,
        ),
        pointBackgroundColor: '#fff',
        pointBorderColor: col,
        pointBorderWidth: 2,
        tension: 0.4,
        // Must stay false. With spanGaps on, a carrier missing the 75/80/85
        // bands got a straight line drawn across them — the chart asserting a
        // premium trajectory the carrier never filed. A gap in the data has to
        // look like a gap.
        spanGaps: false,
        // No area fill. It read as a highlight when one carrier was cheapest;
        // under a band of context lines it just obscures them.
        fill: false,
      };
    }),
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    // 'index' listed every carrier in one tooltip. With the whole field on
    // the chart that is unreadable, so the tooltip names the nearest line —
    // which is also how someone identifies a context line they hovered.
    interaction: { mode: 'nearest', intersect: false },
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

  const togglePin = (name: string) => {
    setPinned((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      // At the cap the oldest pin falls off, so a click always does something
      // visible rather than silently no-op'ing.
      return [...prev.slice(prev.length >= MAX_PINS ? 1 : 0), name];
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

      <div className="ms-rank">
        <div className="ms-rank-head">
          All {carriers.length} carriers, cheapest first from {age} to {targetAge}. Pick up to{' '}
          {MAX_PINS} to chart; the rest stay on as context.
        </div>
        {ranked.map(({ c, t }) => {
          const pi = pinned.indexOf(c.n);
          const on = pi >= 0;
          // A carrier with nothing filed for this gender is labelled as such
          // rather than rendered bare. Bare reads as cheap, or as a figure
          // that merely happens to be missing from this one age band.
          const none = !hasAnyRate(c, gender);
          const genderWord = gender === 'F' ? 'female' : 'male';
          return (
            <button
              key={c.n}
              type="button"
              aria-pressed={on}
              className={`ms-rank-row${on ? ' ms-on' : ''}${none ? ' ms-leg-norate' : ''}`}
              onClick={() => togglePin(c.n)}
              title={none ? `${c.n} — no ${genderWord} rate on file` : c.n}
            >
              <span
                className="ms-d"
                style={{ background: on ? SERIES[pi % SERIES.length] : CONTEXT }}
              />
              <span className="ms-rank-name">{carrierShortName(c.n)}</span>
              <span className="ms-rank-amt">
                {none
                  ? `no ${genderWord} rate on file`
                  : t === null
                    ? 'partial curve'
                    : fmt(t)}
              </span>
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
        {/* Carriers as rows, not columns. Transposed, this table grew a
            column per carrier and stopped being readable well before the
            board reached its current size. */}
        <table className="ms-tbl ms-tbl-rows">
          <thead>
            <tr>
              <th>Carrier</th>
              <th>Rate type</th>
              {tableAges.map((a) => (
                <th key={a} className={a === age ? 'ms-current' : ''}>
                  {a}
                </th>
              ))}
              <th>
                Total {age}&rarr;{targetAge}
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ c, t }) => {
              const pi = pinned.indexOf(c.n);
              return (
                <tr key={c.n}>
                  <td className="ms-tbl-name" title={c.n}>
                    <span
                      className="ms-d"
                      style={{
                        background: pi >= 0 ? SERIES[pi % SERIES.length] : CONTEXT,
                      }}
                    />
                    {carrierShortName(c.n)}
                  </td>
                  <td>{rateTypeLabel(c.ra)}</td>
                  {tableAges.map((a) => {
                    const pr = rateAt(c, gender, a);
                    // Was `c[gender][age] || 1`: a carrier with no premium at
                    // the applicant's current age had its increase measured
                    // against one dollar, rendering figures like "+20,500%".
                    const pctChange = pctChangeFromBase(c, gender, age, a);
                    return (
                      <td key={a} className={a === age ? 'ms-current' : ''}>
                        {fmt(pr)}
                        {pctChange !== null && (
                          <>
                            {' '}
                            <span className="ms-inc">+{pctChange}%</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td>{fmt(t)}</td>
                </tr>
              );
            })}
            {/* "Lowest", not "Best". This row reports the smallest filed
                premium at each age band, which is a fact about the figures
                above it. "Best" is a judgement about which policy someone
                should buy, and this table knows nothing about that. */}
            <tr className="ms-lowest-row">
              <td>Lowest</td>
              <td />
              {tableAges.map((a) => {
                const lo = cheapestAt(visible, gender, a);
                return <td key={a}>{lo ? carrierShortName(lo.n) : '\u2014'}</td>;
              })}
              <td title={lowestTotal?.n ?? ''}>
                {lowestTotal ? carrierShortName(lowestTotal.n) : '\u2014'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* The appointment + not-a-quote disclosure that used to live here now
          renders from RateProjection.tsx. It sat below this widget's success
          branch, so the load-error, loading and zero-carrier returns above all
          dropped it — leaving dollar figures on the page with no disclosure for
          any state without rate rows. Do not re-add it here. */}

      {/* `state` decides the reference ZIP the disclosure names. Without it the
          Texas chart would tell a Dallas reader its rates came from Durham. */}
      <MedSupRateDisclosure gender={gender === 'F' ? 'female' : 'male'} state={state} />
    </div>
  );
}
