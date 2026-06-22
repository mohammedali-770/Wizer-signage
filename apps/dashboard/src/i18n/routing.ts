import { defineRouting } from 'next-intl/routing';

/**
 * Canonical i18n routing definition for the MasterSignage dashboard.
 *
 * - `en` is the default locale (LTR).
 * - `ar` is a fully supported RTL locale.
 *
 * The locale list defined here is the single source of truth consumed by the
 * middleware, request config, navigation helpers and the `[locale]` segment.
 */
export const routing = defineRouting({
  locales: ['en', 'ar'],
  defaultLocale: 'en',
});

export type Locale = (typeof routing.locales)[number];
