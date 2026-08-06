// Tabler-style outline icons — 24×24 viewBox, 2px stroke, currentColor.
// Kept as inline SVGs so we can size + colour them via CSS without
// adding a runtime dep. Only the four factor tiles need icons today.

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

const base = (children: React.ReactNode, { size = 18, strokeWidth = 1.75, className }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

// Tabler: pill
export const IconPill = (p: IconProps = {}) =>
  base(
    <>
      <path d="M4.5 12.5l8 -8a4.94 4.94 0 0 1 7 7l-8 8a4.94 4.94 0 0 1 -7 -7" />
      <path d="M8.5 8.5l7 7" />
    </>,
    p,
  );

// Tabler: heart
export const IconHeart = (p: IconProps = {}) =>
  base(
    <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />,
    p,
  );

// Tabler: scale (build)
export const IconScale = (p: IconProps = {}) =>
  base(
    <>
      <path d="M7 20l10 0" />
      <path d="M6 6l6 -1l6 1" />
      <path d="M12 3l0 17" />
      <path d="M9 12l-3 -6l-3 6a3 3 0 0 0 6 0" />
      <path d="M21 12l-3 -6l-3 6a3 3 0 0 0 6 0" />
    </>,
    p,
  );

// Tabler: smoking-no
export const IconSmokingNo = (p: IconProps = {}) =>
  base(
    <>
      <path d="M3 3l18 18" />
      <path d="M17 12h4v4m-4 0h-2m-4 0h-12v-4h12" />
      <path d="M18 8a2 2 0 0 1 0 -4" />
      <path d="M20.968 12.97a2.017 2.017 0 0 0 .032 -.36v-2.61" />
    </>,
    p,
  );
