'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Menu, X } from 'lucide-react';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';

const NAV_LINKS = [
  { href: '/products', key: 'products' },
  { href: '/signage', key: 'signage' },
  { href: '/future-products', key: 'futureProducts' },
  { href: '/about', key: 'about' },
  { href: '/contact', key: 'contact' },
] as const;

/** Sticky public WIZER header: logo, parent nav, language switcher, login + CTA. */
export function MarketingNavbar() {
  const t = useTranslations('wizer.nav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full border-b bg-white/90 backdrop-blur transition-shadow',
        scrolled ? 'border-slate-200 shadow-sm' : 'border-transparent',
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="WIZER" className="shrink-0">
          <Logo />
        </Link>

        {/* desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {t(l.key)}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <LocaleSwitcher />
          <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900">
            {t('login')}
          </Link>
          <Link
            href="/trial"
            className="inline-flex h-9 items-center justify-center rounded-md bg-[#2563EB] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"
          >
            {t('startTrial')}
          </Link>
        </div>

        {/* mobile toggle */}
        <button
          type="button"
          aria-label={open ? t('close') : t('menu')}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 md:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {/* mobile panel */}
      {open ? (
        <div className="border-t border-slate-200 bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {t(l.key)}
              </Link>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4">
            <LocaleSwitcher />
            <Link
              href="/login"
              className="rounded-md px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              {t('login')}
            </Link>
            <Link
              href="/trial"
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2563EB] px-4 text-sm font-semibold text-white"
            >
              {t('startTrial')}
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
