import { useTranslations } from 'next-intl';
import { Mail, MapPin, Phone } from 'lucide-react';

import { Link } from '@/i18n/navigation';

// Future products have no dedicated page yet -> point to the roadmap (no broken links).
const COLUMNS = [
  {
    titleKey: 'products',
    links: [
      { href: '/signage', key: 'signage' },
      { href: '/future-products', key: 'pos' },
      { href: '/future-products', key: 'erp' },
      { href: '/future-products', key: 'crm' },
      { href: '/future-products', key: 'ai' },
    ],
  },
  {
    titleKey: 'company',
    links: [
      { href: '/about', key: 'about' },
      { href: '/products', key: 'ecosystem' },
      { href: '/contact', key: 'contact' },
    ],
  },
  {
    titleKey: 'legal',
    links: [
      { href: '/privacy', key: 'privacy' },
      { href: '/terms', key: 'terms' },
    ],
  },
] as const;

/** Public WIZER footer: brand, product/company/legal columns, contact, positioning. */
export function MarketingFooter() {
  const t = useTranslations('wizer.footer');
  const year = 2026;

  return (
    <footer className="bg-wizer-navy text-slate-400">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* brand */}
          <div className="max-w-xs">
            <span className="font-wordmark text-xl font-bold tracking-wide text-white">WIZER</span>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">{t('tagline')}</p>
            <ul className="mt-5 space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-slate-500" aria-hidden />
                <span>hello@wizer.sa</span>
              </li>
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-slate-500" aria-hidden />
                <span dir="ltr">+966 5X XXX XXXX</span>
              </li>
              <li className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
                <span>{t('location')}</span>
              </li>
            </ul>
          </div>

          {/* link columns */}
          {COLUMNS.map((col) => (
            <div key={col.titleKey}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
                {t(`columns.${col.titleKey}`)}
              </h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l, i) => (
                  <li key={`${col.titleKey}-${l.key}-${i}`}>
                    <Link
                      href={l.href}
                      className="text-sm text-slate-400 transition-colors hover:text-white"
                    >
                      {t(`${col.titleKey}.${l.key}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            © {year} WIZER. {t('rights')}
          </p>
          <p className="text-xs text-slate-500">{t('positioning')}</p>
        </div>
      </div>
    </footer>
  );
}
