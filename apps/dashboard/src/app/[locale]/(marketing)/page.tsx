'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Boxes,
  Brain,
  Building2,
  Check,
  LayoutGrid,
  LineChart,
  MapPin,
  Monitor,
  Network,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge, SectionHeading } from '@/components/marketing/ui';
import { NetworkHero, StatusPill } from '@/components/marketing/wizer-visuals';
import { DashboardMockup } from '@/components/marketing/visuals';

const WHAT: { key: string; Icon: LucideIcon }[] = [
  { key: 'connect', Icon: Network },
  { key: 'organize', Icon: LayoutGrid },
  { key: 'decide', Icon: LineChart },
];

const PRODUCTS: { code: string; Icon: LucideIcon; available: boolean; href?: string }[] = [
  { code: 'signage', Icon: Monitor, available: true, href: '/signage' },
  { code: 'pos', Icon: ShoppingCart, available: false },
  { code: 'erp', Icon: Boxes, available: false },
  { code: 'crm', Icon: Users, available: false },
  { code: 'hr', Icon: UserCog, available: false },
  { code: 'ai', Icon: Brain, available: false },
  { code: 'analytics', Icon: BarChart3, available: false },
];

const SIGNAGE_FEATURES = [
  'pairing',
  'library',
  'playlists',
  'scheduling',
  'branches',
  'status',
  'androidTv',
  'offline',
  'bilingual',
] as const;

const WHY: { key: string; Icon: LucideIcon }[] = [
  { key: 'intelligence', Icon: Sparkles },
  { key: 'integration', Icon: Boxes },
  { key: 'saudi', Icon: MapPin },
  { key: 'enterprise', Icon: ShieldCheck },
];

const PRIMARY_BTN =
  'inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]';
const OUTLINE_DARK =
  'inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10';
const OUTLINE_LIGHT =
  'inline-flex h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50';

export default function WizerHome() {
  const t = useTranslations();

  return (
    <>
      {/* 1. HERO */}
      <section className="bg-wizer-navy relative overflow-hidden text-white">
        <Container className="relative py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                <span className="bg-wizer-cyan h-1.5 w-1.5 rounded-full" />
                {t('wizer.hero.badge')}
              </span>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                {t('wizer.hero.title')}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-slate-300">
                {t('wizer.hero.subtitle')}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/contact" className={PRIMARY_BTN}>
                  {t('wizer.hero.ctaPrimary')}
                </Link>
                <Link href="/products" className={OUTLINE_DARK}>
                  {t('wizer.hero.ctaSecondary')}
                </Link>
              </div>
              <p className="text-sm text-slate-400">{t('wizer.hero.note')}</p>
            </Reveal>
            <Reveal delay={120}>
              <NetworkHero className="mx-auto aspect-square w-full max-w-md" />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* 2. WHAT WIZER DOES */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <SectionHeading title={t('wizer.what.title')} subtitle={t('wizer.what.subtitle')} />
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {WHAT.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 60}>
                <div className="h-full rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`wizer.what.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`wizer.what.items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 3. PRODUCT ECOSYSTEM */}
      <section className="bg-wizer-light py-20 sm:py-24">
        <Container>
          <SectionHeading
            eyebrow={t('wizer.ecosystem.parentLabel')}
            title={t('wizer.ecosystem.title')}
            subtitle={t('wizer.ecosystem.subtitle')}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map(({ code, Icon, available, href }, i) => {
              const card = (
                <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <IconBadge className={available ? '' : 'bg-slate-100 text-slate-400'}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </IconBadge>
                    <StatusPill
                      available={available}
                      label={
                        available
                          ? t('wizer.ecosystem.currentLabel')
                          : t('wizer.ecosystem.comingSoon')
                      }
                    />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`wizer.ecosystem.products.${code}.name`)}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`wizer.ecosystem.products.${code}.desc`)}
                  </p>
                </div>
              );
              return (
                <Reveal key={code} delay={i * 50}>
                  {href ? (
                    <Link href={href} className="block h-full">
                      {card}
                    </Link>
                  ) : (
                    card
                  )}
                </Reveal>
              );
            })}
          </div>
        </Container>
      </section>

      {/* 4. WIZER SIGNAGE FEATURE SECTION */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal className="flex flex-col gap-5">
              <span className="text-sm font-semibold uppercase tracking-wider text-[#2563EB]">
                {t('wizer.ecosystem.currentLabel')}
              </span>
              <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t('wizer.signageSection.title')}
              </h2>
              <p className="text-lg font-medium text-slate-800">
                {t('wizer.signageSection.tagline')}
              </p>
              <p className="leading-relaxed text-slate-600">{t('wizer.signageSection.subtitle')}</p>
              <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {SIGNAGE_FEATURES.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-700">
                    <Check className="h-4 w-4 shrink-0 text-[#10B981]" aria-hidden />
                    {t(`wizer.signageSection.features.${f}`)}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <Link href="/signage" className={PRIMARY_BTN}>
                  {t('wizer.signageSection.ctaPrimary')}
                </Link>
                <Link href="/trial" className={OUTLINE_LIGHT}>
                  {t('wizer.signageSection.ctaSecondary')}
                </Link>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <DashboardMockup />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* 5. FUTURE PRODUCTS */}
      <section className="bg-wizer-light py-20 sm:py-24">
        <Container>
          <SectionHeading title={t('wizer.future.title')} subtitle={t('wizer.future.subtitle')} />
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {PRODUCTS.filter((p) => !p.available).map(({ code, Icon }, i) => (
              <Reveal key={code} delay={i * 40}>
                <div className="flex h-full flex-col items-center gap-2 rounded-2xl bg-white p-5 text-center shadow-sm">
                  <Icon className="text-wizer-cyan h-6 w-6" aria-hidden />
                  <span className="text-sm font-medium text-slate-800">
                    {t(`wizer.ecosystem.products.${code}.name`)}
                  </span>
                  <span className="text-xs text-slate-400">{t('wizer.ecosystem.comingSoon')}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 6. WHY WIZER */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <SectionHeading title={t('wizer.why.title')} subtitle={t('wizer.why.subtitle')} />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {WHY.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="h-full rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">
                    {t(`wizer.why.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t(`wizer.why.items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 7. BUILT IN SAUDI ARABIA */}
      <section className="bg-wizer-navy py-20 text-white sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <Building2 className="text-wizer-cyan h-8 w-8" aria-hidden />
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
              {t('wizer.saudi.title')}
            </h2>
            <p className="text-lg leading-relaxed text-slate-300">{t('wizer.saudi.subtitle')}</p>
          </Reveal>
        </Container>
      </section>

      {/* 8. FINAL CTA */}
      <section className="bg-white py-16 sm:py-20">
        <Container>
          <Reveal className="from-wizer-navy flex flex-col items-center gap-6 rounded-3xl bg-gradient-to-br to-[#111a33] px-6 py-16 text-center text-white shadow-xl">
            <h2 className="font-display max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {t('wizer.cta.title')}
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-slate-300">
              {t('wizer.cta.subtitle')}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className={PRIMARY_BTN}>
                {t('wizer.cta.primary')}
              </Link>
              <Link href="/trial" className={OUTLINE_DARK}>
                {t('wizer.cta.secondary')}
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
