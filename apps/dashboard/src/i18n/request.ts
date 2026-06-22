import { getRequestConfig } from 'next-intl/server';
import { routing, type Locale } from './routing';

/**
 * Per-request i18n configuration for the App Router.
 *
 * Resolves the active locale from the request, falls back to the default
 * locale when the requested value is not supported, and lazily loads the
 * matching message catalogue from `messages/<locale>.json`.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;

  const locale: Locale = routing.locales.includes(requested as Locale)
    ? (requested as Locale)
    : routing.defaultLocale;

  const messages = (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages,
  };
});
