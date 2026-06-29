'use client';

import { useTranslations } from 'next-intl';
import { CalendarCheck, Mail, MapPin, Phone, Rocket } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';
import { NetworkHero } from '@/components/marketing/wizer-visuals';

export default function ContactPage() {
  const t = useTranslations();
  return (
    <section className="bg-wizer-light py-20 sm:py-24">
      <Container>
        <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
          {/* left — info */}
          <Reveal className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                {t('wizer.contact.title')}
              </h1>
              <p className="text-lg leading-relaxed text-slate-600">
                {t('wizer.contact.subtitle')}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                {t('wizer.contact.infoTitle')}
              </h2>
              <ul className="mt-4 space-y-4 text-sm">
                <li className="flex items-center gap-3">
                  <Mail className="text-wizer-blue h-5 w-5" aria-hidden />
                  <a
                    href={`mailto:${t('wizer.contact.email')}`}
                    className="text-slate-700 hover:underline"
                  >
                    {t('wizer.contact.email')}
                  </a>
                </li>
                <li className="flex items-center gap-3">
                  <Phone className="text-wizer-blue h-5 w-5" aria-hidden />
                  <span className="text-slate-700" dir="ltr">
                    +966 5X XXX XXXX
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <MapPin className="text-wizer-blue h-5 w-5" aria-hidden />
                  <span className="text-slate-700">{t('wizer.footer.location')}</span>
                </li>
              </ul>
            </div>

            <Reveal delay={120} className="hidden lg:block">
              <NetworkHero className="aspect-[4/3] w-full max-w-sm" />
            </Reveal>
          </Reveal>

          {/* right — actions */}
          <Reveal delay={120} className="lg:justify-self-end">
            <div className="w-full max-w-md space-y-4">
              <Link
                href="/demo"
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <IconBadge>
                  <CalendarCheck className="h-5 w-5" aria-hidden />
                </IconBadge>
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {t('wizer.contact.demoCta')}
                  </p>
                  <p className="text-sm text-slate-600">{t('wizer.signageSection.tagline')}</p>
                </div>
              </Link>

              <Link
                href="/trial"
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <IconBadge>
                  <Rocket className="h-5 w-5" aria-hidden />
                </IconBadge>
                <div>
                  <p className="text-base font-semibold text-slate-900">
                    {t('wizer.contact.trialCta')}
                  </p>
                  <p className="text-sm text-slate-600">{t('wizer.hero.note')}</p>
                </div>
              </Link>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
