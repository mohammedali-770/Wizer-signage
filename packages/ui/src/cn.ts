import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind CSS class names safely.
 *
 * Combines `clsx` (conditional class composition) with `tailwind-merge`
 * (resolves conflicting Tailwind utilities so the last one wins). This is the
 * canonical class-name helper used by every component in this package.
 *
 * @example
 * cn('px-2 py-1', isActive && 'bg-blue-500', 'px-4') // -> 'py-1 bg-blue-500 px-4'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
