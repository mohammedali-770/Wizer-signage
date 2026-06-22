import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation primitives.
 *
 * These wrappers automatically prefix paths with the active locale, keeping
 * client navigation, redirects and pathname reads consistent with routing.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
