'use client';

import { useTranslations } from 'next-intl';
import { Compass, Eye, Lightbulb, MapPin, ShieldCheck, Sparkles, Target } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge, SectionHeading } from '@/components/marketing/ui';

const VALUES: { key: string; Icon: LucideIcon }[] = [
  { key: 'clarity', Icon: Lightbulb },
  { key: 'intelligence', Icon: Sparkles },
  { key: 'trust', Icon: ShieldCheck },
  { key: 'local', Icon: MapPin },
];

const PRIMARY_BTN =
  'inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]';
const OUTLINE_DARK =
  'inline-flex h-11 items-center justify-center rounded-md border border-white/20 bg-white/5 px-6 text-sm font-semibold text-white transition hover:bg-white/10';

export default function AboutPage() {
  const t = useTranslations();
  return (
    <>
      <section className="bg-wizer-navy py-16 text-white">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('wizer.about.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">{t('wizer.about.subtitle')}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <Container>
          <Reveal className="mx-auto max-w-3xl text-center">
            <p className="text-lg leading-relaxed text-slate-700">{t('wizer.about.intro')}</p>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {(['mission', 'vision'] as const).map((k, i) => (
              <Reveal key={k} delay={i * 80}>
                <div className="bg-wizer-light h-full rounded-2xl p-8 shadow-sm">
                  <IconBadge>
                    {k === 'mission' ? (
                      <Target className="h-5 w-5" aria-hidden />
                    ) : (
                      <Eye className="h-5 w-5" aria-hidden />
                    )}
                  </IconBadge>
                  <h2 className="mt-4 text-xl font-semibold text-slate-900">
                    {t(`wizer.about.${k}.title`)}
                  </h2>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`wizer.about.${k}.body`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-wizer-light py-20 sm:py-24">
        <Container>
          <SectionHeading title={t('wizer.about.values.title')} />
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 50}>
                <div className="h-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">
                    {t(`wizer.about.values.items.${key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {t(`wizer.about.values.items.${key}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-wizer-navy py-16 text-white">
        <Container>
          <Reveal className="flex flex-col items-center gap-5 text-center">
            <Compass className="text-wizer-cyan h-8 w-8" aria-hidden />
            <h2 className="font-display max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">
              {t('wizer.cta.title')}
            </h2>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className={PRIMARY_BTN}>
                {t('wizer.cta.primary')}
              </Link>
              <Link href="/products" className={OUTLINE_DARK}>
                {t('wizer.ecosystem.exploreCta')}
              </Link>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
