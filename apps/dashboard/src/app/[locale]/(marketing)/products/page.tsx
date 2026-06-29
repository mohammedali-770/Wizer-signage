'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  Boxes,
  Brain,
  Monitor,
  ShoppingCart,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/marketing/reveal';
import { Container, IconBadge } from '@/components/marketing/ui';
import { StatusPill } from '@/components/marketing/wizer-visuals';

const PRODUCTS: { code: string; Icon: LucideIcon; available: boolean; href?: string }[] = [
  { code: 'signage', Icon: Monitor, available: true, href: '/signage' },
  { code: 'pos', Icon: ShoppingCart, available: false },
  { code: 'erp', Icon: Boxes, available: false },
  { code: 'crm', Icon: Users, available: false },
  { code: 'hr', Icon: UserCog, available: false },
  { code: 'ai', Icon: Brain, available: false },
  { code: 'analytics', Icon: BarChart3, available: false },
];

export default function ProductsPage() {
  const t = useTranslations();
  return (
    <>
      <section className="bg-wizer-navy py-16 text-white">
        <Container>
          <Reveal className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
            <span className="text-wizer-cyan text-sm font-semibold uppercase tracking-wider">
              {t('wizer.ecosystem.parentLabel')}
            </span>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('wizer.products.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">{t('wizer.products.subtitle')}</p>
          </Reveal>
        </Container>
      </section>

      <section className="bg-white py-20 sm:py-24">
        <Container>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
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
                  <h2 className="mt-4 text-lg font-semibold text-slate-900">
                    {t(`wizer.ecosystem.products.${code}.name`)}
                  </h2>
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
          <div className="mt-10 text-center">
            <Link
              href="/contact"
              className="inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]"
            >
              {t('wizer.cta.primary')}
            </Link>
          </div>
        </Container>
      </section>
    </>
  );
}
