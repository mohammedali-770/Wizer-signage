'use client';

import { ScrollText } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Container, IconBadge } from '@/components/marketing/ui';
import { Reveal } from '@/components/marketing/reveal';

export default function TermsPage() {
  const t = useTranslations();
  const sections = t.raw('marketing.legal.terms.sections') as { heading: string; body: string }[];

  return (
    <main className="bg-white">
      {/* Header */}
      <section className="bg-[#0B1220] py-20 text-white sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-5">
            <IconBadge className="bg-white/10 text-white">
              <ScrollText className="h-5 w-5" aria-hidden="true" />
            </IconBadge>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('marketing.legal.terms.title')}
            </h1>
            <p className="text-sm font-medium text-slate-400">{t('marketing.legal.updated')}</p>
            <p className="text-lg leading-relaxed text-slate-300">
              {t('marketing.legal.terms.intro')}
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Sections */}
      <section className="py-20 sm:py-24">
        <Container>
          <div className="mx-auto flex max-w-3xl flex-col gap-12">
            {sections.map((section, i) => (
              <Reveal key={section.heading} as="section" delay={i * 60}>
                <div className="flex flex-col gap-3">
                  <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                    {section.heading}
                  </h2>
                  <p className="text-lg leading-relaxed text-slate-600">{section.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </main>
  );
}
