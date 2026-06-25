'use client';

import {
  UtensilsCrossed,
  Coffee,
  ShoppingBag,
  Stethoscope,
  Dumbbell,
  GraduationCap,
  Building2,
  Hotel,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';
import { ScreenGridPattern } from '@/components/marketing/visuals';
import { Link } from '@/i18n/navigation';

type IndustryKey =
  | 'restaurants'
  | 'cafes'
  | 'retail'
  | 'clinics'
  | 'gyms'
  | 'schools'
  | 'offices'
  | 'hotels'
  | 'franchises';

const INDUSTRIES: { key: IndustryKey; Icon: LucideIcon }[] = [
  { key: 'restaurants', Icon: UtensilsCrossed },
  { key: 'cafes', Icon: Coffee },
  { key: 'retail', Icon: ShoppingBag },
  { key: 'clinics', Icon: Stethoscope },
  { key: 'gyms', Icon: Dumbbell },
  { key: 'schools', Icon: GraduationCap },
  { key: 'offices', Icon: Building2 },
  { key: 'hotels', Icon: Hotel },
  { key: 'franchises', Icon: Network },
];

export default function IndustriesPage() {
  const t = useTranslations();

  return (
    <main>
      {/* Compact dark hero */}
      <section className="relative overflow-hidden bg-[#0B1220] py-20 text-white sm:py-24">
        <div className="pointer-events-none absolute inset-0 opacity-[0.06]">
          <ScreenGridPattern className="h-full w-full" />
        </div>
        <div
          className="pointer-events-none absolute -top-24 start-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-[#2563EB]/25 blur-3xl"
          aria-hidden
        />
        <Container className="relative">
          <Reveal className="mx-auto max-w-3xl text-center">
            <span className="text-sm font-semibold uppercase tracking-wider text-[#2563EB]">
              {t('marketing.industries.title')}
            </span>
            <h1 className="font-display mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              {t('marketing.industries.title')}
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-300">
              {t('marketing.industries.subtitle')}
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Industries grid */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-[#2563EB]/40 hover:shadow-lg">
                  <IconBadge className="transition group-hover:bg-[#2563EB] group-hover:text-white">
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="font-display mt-5 text-xl font-semibold text-slate-900">
                    {t(`marketing.industries.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`marketing.industries.items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="bg-[#0B1220] py-20 text-white sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {t('marketing.home.finalCta.title')}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-300">
              {t('marketing.home.finalCta.subtitle')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/trial"
                className="inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]"
              >
                {t('marketing.home.finalCta.ctaPrimary')}
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t('marketing.home.finalCta.ctaSecondary')}
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </main>
  );
}
