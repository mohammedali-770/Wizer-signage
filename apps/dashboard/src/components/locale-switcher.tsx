'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Languages } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';

/**
 * Switches the active locale while preserving the current pathname.
 *
 * Uses the locale-aware navigation helpers so the router re-resolves the
 * route under the newly selected locale segment.
 */
export function LocaleSwitcher() {
  const t = useTranslations('locale');
  const activeLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onSelect(nextLocale: Locale) {
    if (nextLocale === activeLocale) return;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  return (
    <div
      role="group"
      aria-label={t('label')}
      className="border-border bg-background inline-flex items-center gap-1 rounded-md border p-1"
    >
      <Languages className="text-muted-foreground mx-1 h-4 w-4" aria-hidden="true" />
      {routing.locales.map((locale) => (
        <button
          key={locale}
          type="button"
          disabled={isPending}
          aria-pressed={locale === activeLocale}
          onClick={() => onSelect(locale)}
          className={cn(
            'rounded px-2 py-1 text-sm font-medium transition-colors',
            'focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-2',
            locale === activeLocale
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {t(locale)}
        </button>
      ))}
    </div>
  );
}
