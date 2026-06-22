import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/**
 * A surface/container primitive with sensible default padding, border, and
 * dark-mode-aware background. Compose freely; no business logic.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-4 shadow-sm',
        'dark:border-gray-800 dark:bg-gray-950',
        className,
      )}
      {...props}
    />
  );
}
