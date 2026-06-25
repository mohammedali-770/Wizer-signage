'use client';

import { useTranslations } from 'next-intl';
import {
  MonitorSmartphone,
  Library,
  ListVideo,
  CalendarClock,
  Building2,
  WifiOff,
  Activity,
  Languages,
  Tv,
  ShieldCheck,
  Cloud,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';
import { Link } from '@/i18n/navigation';

const FEATURE_ITEMS: { key: string; Icon: LucideIcon }[] = [
  { key: 'pairing', Icon: MonitorSmartphone },
  { key: 'library', Icon: Library },
  { key: 'playlists', Icon: ListVideo },
  { key: 'scheduling', Icon: CalendarClock },
  { key: 'branches', Icon: Building2 },
  { key: 'offline', Icon: WifiOff },
  { key: 'status', Icon: Activity },
  { key: 'bilingual', Icon: Languages },
  { key: 'androidTv', Icon: Tv },
  { key: 'roles', Icon: ShieldCheck },
  { key: 'cloud', Icon: Cloud },
  { key: 'scale', Icon: Network },
];

export default function FeaturesPage() {
  const t = useTranslations();

  return (
    <>
      {/* Hero */}
      <section className="bg-[#0B1220] py-16 text-white">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('marketing.features.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">
              {t('marketing.features.subtitle')}
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Feature grid */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_ITEMS.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="h-full rounded-2xl border border-slate-200 p-6 shadow-sm transition hover:shadow-md">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </IconBadge>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`marketing.features.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`marketing.features.items.${key}.desc`)}
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
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {t('marketing.home.finalCta.title')}
            </h2>
            <p className="text-lg leading-relaxed text-slate-300">
              {t('marketing.home.finalCta.subtitle')}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
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
    </>
  );
}
