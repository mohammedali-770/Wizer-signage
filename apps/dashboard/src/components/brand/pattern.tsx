/**
 * Wizer Signage "Connected Screen Grid" — the proprietary brand pattern:
 * tiled rounded screen frames with small status dots. Decorative only; uses
 * currentColor so the caller controls hue + opacity (keep it very subtle).
 */
export function BrandPattern({ className }: { className?: string }) {
  return (
    <svg className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="ms-screen-grid" width="72" height="56" patternUnits="userSpaceOnUse">
          <rect
            x="12"
            y="9"
            width="48"
            height="32"
            rx="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="18" cy="15" r="1.6" fill="currentColor" />
          <line x1="36" y1="41" x2="36" y2="49" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="36" cy="51" r="1.6" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ms-screen-grid)" />
    </svg>
  );
}
