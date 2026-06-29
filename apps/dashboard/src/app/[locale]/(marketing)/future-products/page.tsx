'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Boxes,
  Brain,
  ShoppingCart,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';
import { StatusPill } from '@/components/marketing/wizer-visuals';

const FUTURE: { code: string; Icon: LucideIcon }[] = [
  { code: 'pos', Icon: ShoppingCart },
  { code: 'erp', Icon: Boxes },
  { code: 'crm', Icon: Users },
  { code: 'hr', Icon: UserCog },
  { code: 'ai', Icon: Brain },
  { code: 'analytics', Icon: BarChart3 },
];

export default function FutureProductsPage() {
  const t = useTranslations();
  return (
    <>
      <section className="bg-wizer-navy py-16 text-white">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('wizer.futureProducts.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">
              {t('wizer.futureProducts.subtitle')}
            </p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FUTURE.map(({ code, Icon }, i) => (
              <Reveal key={code} delay={i * 50}>
                <div className="flex h-full flex-col rounded-2xl border border-slate-200 p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <IconBadge className="bg-slate-100 text-slate-400">
                      <Icon className="h-5 w-5" aria-hidden />
                    </IconBadge>
                    <StatusPill label={t('wizer.ecosystem.comingSoon')} />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`wizer.ecosystem.products.${code}.name`)}
                  </h2>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {t(`wizer.ecosystem.products.${code}.desc`)}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-12 text-center">
            <p className="text-slate-600">{t('wizer.futureProducts.note')}</p>
            <Link
              href="/contact"
              className="mt-5 inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]"
            >
              {t('wizer.cta.primary')}
            </Link>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
