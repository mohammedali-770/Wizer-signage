import { cn } from '@/lib/cn';

/** Outer node positions of the WIZER "W" network mark (viewBox 0 0 100 100). */
const WIZER_OUTER_NODES: ReadonlyArray<readonly [number, number]> = [
  [15, 34], // top-left
  [85, 34], // top-right
  [34, 78], // bottom-left
  [66, 78], // bottom-right
];

/**
 * Official WIZER mark — the connected "W" node-network with a spark, in the
 * brand blue -> cyan gradient (#2563EB -> #06B6D4). Geometry taken from the
 * WIZER Brand Board icon: a wide crown-"W" (two top-outer nodes, a larger
 * centre node, two lower inner nodes) with network crossings to the centre and
 * a centred vertical spark. Nodes are white-filled rings, so the mark reads on
 * both light and navy surfaces.
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
      {/* connections — the W (TL-BL-C-BR-TR) plus the network crossings to the centre */}
      <path
        d="M15 34 L34 78 M34 78 L50 51 M50 51 L66 78 M66 78 L85 34 M15 34 L50 51 M85 34 L50 51"
        stroke="url(#wizerGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* spark (centred, vertical 4-point) */}
      <path
        d="M50 18.5 L51.1 22.9 L54 24 L51.1 25.1 L50 29.5 L48.9 25.1 L46 24 L48.9 22.9 Z"
        fill="#2563EB"
      />
      {/* outer nodes */}
      {WIZER_OUTER_NODES.map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="4"
          fill="#fff"
          stroke="url(#wizerGrad)"
          strokeWidth="2.4"
        />
      ))}
      {/* centre node (larger) */}
      <circle cx="50" cy="51" r="5.6" fill="#fff" stroke="url(#wizerGrad)" strokeWidth="3" />
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
