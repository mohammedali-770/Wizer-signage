import { cn } from '@/lib/cn';

/**
 * MasterSignage brand mark — "M Signal Screen".
 * A rounded screen frame (adapts to the surrounding text color via
 * currentColor, so it reads on both the navy sidebar and white surfaces) with
 * an M built from connected nodes and a signal emitter, in Signal Blue.
 */
export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      className={className}
      fill="none"
      role="img"
      aria-label="MasterSignage"
    >
      {/* Screen frame — inherits the text color of its context. */}
      <rect x="8" y="11" width="48" height="30" rx="7" stroke="currentColor" strokeWidth="3.4" />
      {/* The "M" as a connected-node path (Signal Blue). */}
      <path
        d="M18 33 L25 18 L32 28 L39 18 L46 33"
        stroke="#2563EB"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill="#2563EB">
        <circle cx="18" cy="33" r="2.6" />
        <circle cx="32" cy="28" r="2.6" />
        <circle cx="46" cy="33" r="2.6" />
        <circle cx="39" cy="18" r="2.6" />
        {/* Signal emitter sits on the top-left peak of the M. */}
        <circle cx="25" cy="18" r="3.1" />
      </g>
      <g stroke="#2563EB" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M20.5 14.5 A 6 6 0 0 1 29.5 14.5" />
        <path d="M18 12 A 10 10 0 0 1 32 12" />
      </g>
    </svg>
  );
}

/**
 * Full lockup: icon + wordmark. "Master" inherits the context color
 * (navy on light, white on the sidebar); "Signage" is always Signal Blue.
 */
export function Logo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoIcon className="h-7 w-9 shrink-0" />
      {showWordmark ? (
        <span className="font-display text-lg font-bold tracking-tight">
          Master<span className="text-primary">Signage</span>
        </span>
      ) : null}
    </span>
  );
}
