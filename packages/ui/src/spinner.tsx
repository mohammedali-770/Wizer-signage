import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** Visual size of the {@link Spinner}. */
export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  /** Diameter preset. Defaults to `'md'`. */
  size?: SpinnerSize;
  /** Accessible label announced to assistive technology. */
  label?: string;
}

const SIZE_CLASSES: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-[3px]',
};

/**
 * An indeterminate loading spinner built purely from Tailwind utility classes.
 *
 * Foundational primitive — no business logic. The current text color is used
 * for the visible arc via `border-current`, so it inherits from its context.
 */
export function Spinner({
  size = 'md',
  label = 'Loading',
  className,
  ...props
}: SpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={label}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent text-current',
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
