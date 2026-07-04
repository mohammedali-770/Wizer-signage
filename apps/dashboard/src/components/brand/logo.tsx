import { cn } from '@/lib/cn';

/** Node positions of the WIZER "W" network mark (viewBox 0 0 100 100). */
const WIZER_NODES: ReadonlyArray<readonly [number, number]> = [
  [22, 33], // top-left
  [78, 33], // top-right
  [50, 51], // centre
  [36, 71], // bottom-left
  [64, 71], // bottom-right
];

/**
 * Official WIZER mark — a connected "W" node-network with a spark, in the
 * brand blue -> cyan gradient (#2563EB -> #06B6D4). Recreated as a clean,
 * resolution-independent SVG from the WIZER Brand Board. Nodes are white-filled
 * rings, so the mark reads on both light and dark (navy) surfaces.
 */
export function WizerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="wizerGrad" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563EB" />
          <stop offset="1" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      {/* connections — the W plus the network crossings to the centre node */}
      <path
        d="M22 33 L36 71 M36 71 L50 51 M50 51 L64 71 M64 71 L78 33 M22 33 L50 51 M78 33 L50 51"
        stroke="url(#wizerGrad)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* spark */}
      <path
        d="M62 4 L64.1 10.9 L71 13 L64.1 15.1 L62 22 L59.9 15.1 L53 13 L59.9 10.9 Z"
        fill="url(#wizerGrad)"
      />
      {/* nodes */}
      {WIZER_NODES.map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="7.5"
          fill="#fff"
          stroke="url(#wizerGrad)"
          strokeWidth="5.5"
        />
      ))}
    </svg>
  );
}

/**
 * WIZER brand lockup: the network mark + the "WIZER" wordmark (Saira, via
 * `font-wordmark`). Pass `product` (e.g. "Signage") to render the product
 * lockup "WIZER Signage". Works on light and dark surfaces (uses currentColor).
 */
export function Logo({
  className,
  showWordmark = true,
  product,
}: {
  className?: string;
  showWordmark?: boolean;
  product?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      aria-label={showWordmark ? undefined : product ? `WIZER ${product}` : 'WIZER'}
    >
      <WizerMark className="h-7 w-7 shrink-0" />
      {showWordmark ? (
        <span className="font-wordmark text-lg font-bold leading-none tracking-wide">
          WIZER
          {product ? <span className="text-primary font-semibold"> {product}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
