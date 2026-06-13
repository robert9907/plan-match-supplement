// SVG ring with an animated stroke-dashoffset transition. Used at four
// sizes across the Results screen — header (64), building header (44),
// drop slot (32), and compare modal column (52). Stroke colour follows
// the same score → tone mapping the rest of the app uses.

interface ScoreRingProps {
  score: number;
  size?: number;
  /** True when rendering on the dark navy header — flips the track and
   *  score-text colour to legible-on-dark variants. */
  dark?: boolean;
}

export function ScoreRing({ score, size = 44, dark = false }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = size <= 32 ? 3 : size <= 44 ? 4 : 5;
  const r = (size - stroke) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (clamped / 100) * circumference;
  const color =
    clamped >= 90 ? 'var(--teal)' : clamped >= 80 ? 'var(--amber)' : 'var(--red-c)';
  const trackColor = dark ? 'rgba(255,255,255,0.08)' : '#e2e8f0';
  const textColor = dark ? '#fff' : 'var(--dark)';
  const fontSize = Math.round(size * 0.36);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="score-ring"
      aria-label={`Score ${clamped} of 100`}
    >
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
      />
      <circle
        cx={center}
        cy={center}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: 'stroke-dashoffset 1s ease-out' }}
      />
      <text
        x={center}
        y={center + 1}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'Fraunces', serif"
        fontWeight={800}
        fontSize={fontSize}
        fill={textColor}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {clamped}
      </text>
    </svg>
  );
}
