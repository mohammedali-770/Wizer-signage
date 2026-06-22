import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names conditionally and resolve conflicting Tailwind
 * utilities deterministically (last one wins).
 *
 * Defined locally rather than imported from `@master-signage/ui` to keep the
 * dashboard's styling utilities decoupled from the shared package's surface.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
