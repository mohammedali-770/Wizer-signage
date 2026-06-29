import { cn } from '@/lib/cn';

/**
 * WIZER connected-intelligence network mark. Placeholder SVG built from the
 * approved identity (navy/blue/cyan node network). Adapts to any surface via
 * `currentColor` for the links; blue (#2563EB) + cyan (#06B6D4) accent nodes.
 *
 * TODO(brand): replace with the official WIZER logo SVG when available
 * (see WIZER Brand Board.pdf / WIZER_Brand_Identity_Refinement.pptx).
 */
export function WizerMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M16 5.5 L26 11 M16 5.5 L6 11 M6 11 V21 M26 11 V21 M6 21 L16 26.5 M26 21 L16 26.5 M16 5.5 V26.5 M6 11 L26 21 M26 11 L6 21"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle cx="16" cy="16" r="3.2" fill="#2563EB" />
      <circle cx="16" cy="5.5" r="2.4" fill="#2563EB" />
      <circle cx="16" cy="26.5" r="2.4" fill="#2563EB" />
      <circle cx="26" cy="11" r="2" fill="#06B6D4" />
      <circle cx="6" cy="11" r="2" fill="#06B6D4" />
      <circle cx="6" cy="21" r="2" fill="currentColor" />
      <circle cx="26" cy="21" r="2" fill="currentColor" />
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
