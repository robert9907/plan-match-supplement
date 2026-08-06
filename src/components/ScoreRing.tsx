// SVG ring with an animated stroke-dashoffset transition. Used at four
// sizes across the Results screen — header (60), building header (36),
// drop slot (36), and compare modal column (52). One accent stroke
// colour everywhere; the score number carries the tier meaning. When
// onExplain is set the whole ring becomes the tap target (no floating
// "?" dot badge).

interface ScoreRingProps {
  score: number;
  size?: number;
  /** True when rendering on a dark hero surface — flips the score-text
   *  colour to a legible-on-dark variant. Track darkens automatically. */
  dark?: boolean;
  /** When set, wraps the SVG in a button that opens the Fit Score
   *  explainer. Entire ring is tappable. */
  onExplain?: () => void;
}

export function ScoreRing({ score, size = 36, dark = false, onExplain }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, score));
  const stroke = size <= 40 ? 3 : 4;
  const r = (size - stroke) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (clamped / 100) * circumference;
  const trackColor = dark ? 'rgba(255,255,255,0.10)' : 'rgba(15, 23, 42, 0.08)';
  const textColor = dark ? '#fff' : 'var(--dark)';
  const fontSize = Math.round(size * 0.38);

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="score-ring"
      aria-label={`Fit Score ${clamped} of 100`}
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
        stroke="var(--teal)"
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
        fontWeight={700}
        fontSize={fontSize}
        fill={textColor}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {clamped}
      </text>
    </svg>
  );

  if (!onExplain) return svg;

  return (
    <button
      type="button"
      className="score-ring-btn"
      onClick={(e) => {
        e.stopPropagation();
        onExplain();
      }}
      aria-label={`Fit Score ${clamped} of 100. Tap to see how it's calculated.`}
      title="How is this score calculated?"
    >
      {svg}
    </button>
  );
}
