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

ChartJS.register(
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

const AGES = [65, 70, 75, 80, 85, 90, 95] as const;
type AgeBand = (typeof AGES)[number];

type Gender = 'M' | 'F';

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

  // ── Derived stats (mirror medsupTemplate.js `update()`) ──
  const cheapest = useMemo(() => {
    let best: { n: string; p: number } = { n: '—', p: Infinity };
    for (const c of visible) {
      const p = c[gender][age];
      if (p && p < best.p) best = { n: c.n, p };
    }
    return isFinite(best.p) ? best : { n: '—', p: 0 };
  }, [visible, gender, age]);

  const targetAge = (Math.min(age + 20, 95) as AgeBand);
  const cheapestAtTarget = useMemo(() => {
    let best: { n: string; p: number } = { n: '—', p: Infinity };
    for (const c of visible) {
      const p = c[gender][targetAge];
      if (p && p < best.p) best = { n: c.n, p };
    }
    return isFinite(best.p) ? best : { n: '—', p: 0 };
  }, [visible, gender, targetAge]);

  const lowestTotal = useMemo(() => {
    let best: { n: string; t: number } = { n: '—', t: Infinity };
    for (const c of visible) {
      let t = 0;
      for (let i = 0; i < AGES.length - 1; i++) {
        const a = AGES[i];
        const p = c[gender][a];
        if (p) {
          const span = AGES[i + 1] - a;
          t += p * 12 * (span / 5);
        }
      }
      if (t < best.t) best = { n: c.n, t };
    }
    return isFinite(best.t) ? best : { n: '—', t: 0 };
  }, [visible, gender]);

  const avgIncrease = useMemo(() => {
    const usable = visible.filter(
      (c) => c[gender][age] && c[gender][targetAge],
    );
    if (usable.length === 0) return 0;
    const sum = usable.reduce((acc, c) => {
      const p0 = c[gender][age];
      const p1 = c[gender][targetAge];
      return acc + ((p1 - p0) / p0) * 100;
    }, 0);
    return Math.round(sum / usable.length);
  }, [visible, gender, age, targetAge]);

  const animatedAmount = useAnimatedNumber(Math.round(cheapest.p));

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
          <div className="ms-fallback-title">Coming to {stateLabel(state)} soon</div>
          <div className="ms-fallback-body">
            We're still finalizing carrier rate filings for your state. In the meantime, continue
            below — your carrier matches and quotes are still live.
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
        data: AGES.map((a) => c[gender][a] ?? null),
        borderColor: c.c,
        backgroundColor: c.c + '15',
        borderWidth: isActive ? 2.5 : 0,
        pointRadius: AGES.map((a) =>
          isActive && a === age && c[gender][a] ? 6 : isActive && c[gender][a] ? 3 : 0,
        ),
        pointBackgroundColor: '#fff',
        pointBorderColor: c.c,
        pointBorderWidth: 2,
        hidden: !isActive,
        tension: 0.4,
        spanGaps: true,
        fill: isActive && c.n === cheapest.n,
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
        <div className="ms-big-stat">
          <span className="ms-dollar">$</span>
          <span className="ms-amount">{animatedAmount}</span>
          <span className="ms-per">/mo</span>
        </div>
        <div className="ms-stat-carrier">
          {carrierShortName(cheapest.n)} · Age {age}
        </div>
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
            {fmt(cheapest.p)}
            <span>/mo</span>
          </div>
          <div className="ms-c-sub" title={cheapest.n}>{carrierShortName(cheapest.n)}</div>
        </div>
        <div className="ms-card">
          <div className="ms-c-label">Lowest at {targetAge}</div>
          <div className="ms-c-val">
            {fmt(cheapestAtTarget.p)}
            <span>/mo</span>
          </div>
          <div className="ms-c-sub" title={cheapestAtTarget.n}>{carrierShortName(cheapestAtTarget.n)}</div>
        </div>
        <div className="ms-card">
          <div className="ms-c-label">Lowest 20yr total</div>
          <div className="ms-c-val">{fmt(lowestTotal.t)}</div>
          <div className="ms-c-sub" title={lowestTotal.n}>{carrierShortName(lowestTotal.n)}</div>
        </div>
        <div className="ms-card">
          <div className="ms-c-label">Avg increase</div>
          <div className="ms-c-val">
            {avgIncrease}%<span> over 20yr</span>
          </div>
          <div className="ms-c-sub">
            {age} → {targetAge}
          </div>
        </div>
      </div>

      <div className="ms-legend">
        {carriers.map((c) => {
          const on = active.has(c.n);
          const p = c[gender][age];
          return (
            <button
              key={c.n}
              type="button"
              className={`ms-leg${on ? ' ms-on' : ''}`}
              onClick={() => toggleCarrier(c.n)}
              title={c.n}
            >
              <span className="ms-d" style={{ background: c.c }} />
              {carrierShortName(c.n)}
              {p ? ` ${fmt(p)}` : ''}
            </button>
          );
        })}
      </div>

      <div className="ms-chart-section">
        <div className="ms-chart-wrap">
          <Line data={chartData} options={chartOptions} />
        </div>
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
                const p = c[gender][a];
                const p0 = c[gender][age] || 1;
                const pctChange = a > age && p ? Math.round(((p - p0) / p0) * 100) : null;
                if (p && p < best.p) best = { n: c.n, p };
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

      <div
        className="ms-appointment-disclosure"
        style={{ fontSize: 12, lineHeight: 1.4, color: '#6B7280', margin: '16px 4px 0' }}
      >
        Rates shown are from carriers Generation Health is appointed with and do not represent
        every Medicare Supplement insurer available in your area. Premiums are estimates sourced
        from Medicare.gov and are not a quote or a guarantee of coverage. Rob Simm, NPN #10447418.
      </div>
    </div>
  );
}
