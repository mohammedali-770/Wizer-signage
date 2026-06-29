'use client';

import { useTranslations } from 'next-intl';
import { Boxes, MapPin, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';

const WHY: { key: string; Icon: LucideIcon }[] = [
  { key: 'intelligence', Icon: Sparkles },
  { key: 'integration', Icon: Boxes },
  { key: 'saudi', Icon: MapPin },
  { key: 'enterprise', Icon: ShieldCheck },
];

export default function WhyWizerPage() {
  const t = useTranslations();
  return (
    <>
      <section className="bg-wizer-navy py-16 text-white">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('wizer.why.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">{t('wizer.why.subtitle')}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {WHY.map(({ key, Icon }, i) => (
              <Reveal key={key} delay={i * 60}>
                <div className="flex h-full gap-4 rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <IconBadge>
                    <Icon className="h-5 w-5" aria-hidden />
                  </IconBadge>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {t(`wizer.why.items.${key}.title`)}
                    </h2>
                    <p className="mt-1 leading-relaxed text-slate-600">
                      {t(`wizer.why.items.${key}.desc`)}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="bg-wizer-light py-20 sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
            <MapPin className="text-wizer-cyan h-8 w-8" aria-hidden />
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t('wizer.saudi.title')}
            </h2>
            <p className="text-lg leading-relaxed text-slate-600">{t('wizer.saudi.subtitle')}</p>
            <Link
              href="/contact"
              className="mt-2 inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]"
            >
              {t('wizer.cta.primary')}
            </Link>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
