'use client';

import { useTranslations } from 'next-intl';
import {
  Activity,
  Building2,
  CalendarClock,
  CalendarX,
  Check,
  ChevronDown,
  Cloud,
  Coffee,
  Dumbbell,
  Headset,
  Languages,
  MessageSquare,
  MonitorPlay,
  MonitorSmartphone,
  Network,
  PhoneOff,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Stethoscope,
  Upload,
  Usb,
  UtensilsCrossed,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge, SectionHeading } from '@/components/marketing/ui';
import { DashboardMockup, PairingMock, StatusDot } from '@/components/marketing/visuals';

const PROBLEMS: { key: string; Icon: LucideIcon }[] = [
  { key: 'usb', Icon: Usb },
  { key: 'whatsapp', Icon: MessageSquare },
  { key: 'outdated', Icon: CalendarX },
  { key: 'manual', Icon: PhoneOff },
];

const SOLUTION: { key: string; Icon: LucideIcon }[] = [
  { key: 'upload', Icon: Upload },
  { key: 'schedule', Icon: CalendarClock },
  { key: 'pair', Icon: MonitorSmartphone },
  { key: 'monitor', Icon: Activity },
  { key: 'control', Icon: SlidersHorizontal },
];

const FEATURE_PREVIEW: { key: string; Icon: LucideIcon }[] = [
  { key: 'pairing', Icon: MonitorPlay },
  { key: 'scheduling', Icon: CalendarClock },
  { key: 'branches', Icon: Building2 },
  { key: 'offline', Icon: WifiOff },
  { key: 'status', Icon: Activity },
  { key: 'bilingual', Icon: Languages },
];

const TRUST: { key: string; Icon: LucideIcon }[] = [
  { key: 'bilingual', Icon: Languages },
  { key: 'offline', Icon: WifiOff },
  { key: 'cloud', Icon: Cloud },
  { key: 'roles', Icon: ShieldCheck },
  { key: 'scale', Icon: Network },
  { key: 'support', Icon: Headset },
];

const INDUSTRY_PREVIEW: { key: string; Icon: LucideIcon }[] = [
  { key: 'restaurants', Icon: UtensilsCrossed },
  { key: 'cafes', Icon: Coffee },
  { key: 'retail', Icon: ShoppingBag },
  { key: 'clinics', Icon: Stethoscope },
  { key: 'gyms', Icon: Dumbbell },
  { key: 'offices', Icon: Building2 },
];

const PRIMARY_BTN =
  'inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]';
const OUTLINE_BTN =
  'inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10';

export default function MarketingHome() {
  const t = useTranslations();
  const howSteps = t.raw('marketing.home.how.steps') as { title: string; desc: string }[];
  const faqs = t.raw('marketing.faq.items') as { q: string; a: string }[];

  return (
    <>
      {/* 1. HERO */}
      <section className="relative overflow-hidden bg-[#0B1220] text-white">
        <div className="pointer-events-none absolute inset-0 text-white/[0.05]">
          {/* decorative connected-screen grid */}
        </div>
        <Container className="relative py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <Reveal className="flex flex-col gap-6">
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200">
                <StatusDot tone="online" />
                {t('marketing.home.hero.badge')}
              </span>
              <h1 className="font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                {t('marketing.home.hero.title')}
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-slate-300">
                {t('marketing.home.hero.subtitle')}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/trial" className={PRIMARY_BTN}>
                  {t('marketing.home.hero.ctaPrimary')}
                </Link>
                <Link href="/demo" className={OUTLINE_BTN}>
                  {t('marketing.home.hero.ctaSecondary')}
                </Link>
              </div>
              <p className="text-sm text-slate-400">{t('marketing.home.hero.note')}</p>
            </Reveal>
            <Reveal delay={120}>
              <DashboardMockup />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* 2. PROBLEM */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.problem.title')}
            subtitle={t('marketing.home.problem.subtitle')}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PROBLEMS.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 60}>
                <div className="h-full rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <IconBadge className="bg-[#EF4444]/10 text-[#EF4444]">
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`marketing.home.problem.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`marketing.home.problem.items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 3. SOLUTION */}
      <section className="bg-[#F8FAFC] py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.solution.title')}
            subtitle={t('marketing.home.solution.subtitle')}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {SOLUTION.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 60}>
                <div className="flex h-full flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="font-semibold text-slate-900">
                    {t(`marketing.home.solution.steps.${key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600">
                    {t(`marketing.home.solution.steps.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 4. FEATURES PREVIEW */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.featuresPreview.title')}
            subtitle={t('marketing.home.featuresPreview.subtitle')}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURE_PREVIEW.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="h-full rounded-2xl border border-slate-200 p-6 shadow-sm transition hover:shadow-md">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
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
          <div className="mt-10 text-center">
            <Link
              href="/features"
              className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {t('marketing.home.featuresPreview.cta')}
            </Link>
          </div>
        </Container>
      </section>

      {/* 5. HOW IT WORKS */}
      <section className="bg-[#0B1220] py-20 text-white sm:py-24">
        <Container>
          <SectionHeading
            tone="dark"
            title={t('marketing.home.how.title')}
            subtitle={t('marketing.home.how.subtitle')}
          />
          <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
            <ol className="flex flex-col gap-5">
              {howSteps.map((step, i) => (
                <Reveal key={step.title} as="li" delay={i * 60} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB] text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-white">{step.title}</h3>
                    <p className="mt-1 leading-relaxed text-slate-400">{step.desc}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
            <Reveal delay={120}>
              <PairingMock />
            </Reveal>
          </div>
        </Container>
      </section>

      {/* 6. TRUST */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.trust.title')}
            subtitle={t('marketing.home.trust.subtitle')}
          />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="flex h-full gap-4 rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {t(`marketing.home.trust.items.${key}.title`)}
                    </h3>
                    <p className="mt-1 leading-relaxed text-slate-600">
                      {t(`marketing.home.trust.items.${key}.desc`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 7. INDUSTRIES PREVIEW */}
      <section className="bg-[#F8FAFC] py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.industriesPreview.title')}
            subtitle={t('marketing.home.industriesPreview.subtitle')}
          />
          <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {INDUSTRY_PREVIEW.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 40}>
                <div className="flex h-full flex-col items-center gap-2 rounded-2xl bg-white p-5 text-center shadow-sm">
                  <Icon className="h-6 w-6 text-[#2563EB]" aria-hidden />
                  <span className="text-sm font-medium text-slate-800">
                    {t(`marketing.industries.items.${key}.title`)}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link
              href="/industries"
              className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 px-6 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {t('marketing.home.industriesPreview.cta')}
            </Link>
          </div>
        </Container>
      </section>

      {/* 8. PRICING PREVIEW */}
      <section className="bg-white py-20 sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <SectionHeading
              title={t('marketing.home.pricingPreview.title')}
              subtitle={t('marketing.home.pricingPreview.subtitle')}
            />
            <Link href="/pricing" className={PRIMARY_BTN}>
              {t('marketing.home.pricingPreview.cta')}
            </Link>
          </Reveal>
        </Container>
      </section>

      {/* 9. FAQ */}
      <section className="bg-[#F8FAFC] py-20 sm:py-24">
        <Container>
          <SectionHeading
            title={t('marketing.home.faq.title')}
            subtitle={t('marketing.home.faq.subtitle')}
          />
          <div className="mx-auto mt-12 max-w-3xl space-y-4">
            {faqs.map((item, i) => (
              <Reveal key={item.q} delay={i * 40}>
                <details className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900">
                    {item.q}
                    <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600">{item.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* 10. FINAL CTA */}
      <section className="bg-white py-16 sm:py-20">
        <Container>
          <Reveal className="flex flex-col items-center gap-6 rounded-3xl bg-gradient-to-br from-[#0B1220] to-[#1E293B] px-6 py-16 text-center text-white shadow-xl">
            <h2 className="font-display max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {t('marketing.home.finalCta.title')}
            </h2>
            <p className="max-w-xl text-lg leading-relaxed text-slate-300">
              {t('marketing.home.finalCta.subtitle')}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/trial" className={PRIMARY_BTN}>
                {t('marketing.home.finalCta.ctaPrimary')}
              </Link>
              <Link href="/demo" className={OUTLINE_BTN}>
                {t('marketing.home.finalCta.ctaSecondary')}
              </Link>
            </div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-400">
              <Check className="h-4 w-4 text-[#10B981]" /> {t('marketing.home.hero.note')}
            </p>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
