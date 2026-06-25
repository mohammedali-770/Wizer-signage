'use client';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Container } from '@/components/marketing/ui';
import { Reveal } from '@/components/marketing/reveal';

type Section = { heading: string; body: string };

export default function PrivacyPage() {
  const t = useTranslations();
  const sections = t.raw('marketing.legal.privacy.sections') as Section[];

  return (
    <main className="bg-white">
      <section className="py-16 sm:py-20">
        <Container>
          <div className="mx-auto max-w-3xl">
            <Reveal className="flex flex-col gap-4 border-b border-slate-200 pb-8">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#2563EB]/10 text-[#2563EB]">
                <ShieldCheck className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                {t('marketing.legal.privacy.title')}
              </h1>
              <p className="text-sm font-medium text-[#64748B]">{t('marketing.legal.updated')}</p>
              <p className="text-lg leading-relaxed text-slate-600">
                {t('marketing.legal.privacy.intro')}
              </p>
            </Reveal>

            <div className="mt-10 flex flex-col gap-10">
              {sections.map((section, i) => (
                <Reveal as="div" key={section.heading} delay={i * 60}>
                  <article className="flex flex-col gap-3">
                    <h2 className="font-display text-xl font-semibold text-slate-900">
                      {section.heading}
                    </h2>
                    <p className="leading-relaxed text-slate-600">{section.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </main>
  );
}
