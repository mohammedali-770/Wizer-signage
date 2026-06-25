'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, RefreshCcw, Sparkles } from 'lucide-react';

import { Reveal } from '@/components/marketing/reveal';
import { Container } from '@/components/marketing/ui';
import { Button, Card, Spinner } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';

type Plan = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number | null;
  currency: string;
  trialDays: number;
  limits: Record<string, number | null>;
};

type Billing = 'monthly' | 'yearly';

const KNOWN_CODES = new Set(['starter', 'business', 'enterprise']);

export default function PricingPage() {
  const t = useTranslations();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [billing, setBilling] = useState<Billing>('monthly');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<Plan[]>('/public/plans');
      setPlans(Array.isArray(data) ? data.slice(0, 3) : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const planName = (plan: Plan) =>
    KNOWN_CODES.has(plan.code) ? t(`marketing.pricing.plans.${plan.code}.name`) : plan.name;

  const planTagline = (plan: Plan) =>
    KNOWN_CODES.has(plan.code)
      ? t(`marketing.pricing.plans.${plan.code}.tagline`)
      : (plan.description ?? '');

  const isCustom = (plan: Plan) => plan.code === 'enterprise' || plan.priceMonthly === 0;

  const planFeatures = (plan: Plan): string[] => {
    const lim = plan.limits ?? {};
    const features: string[] = [];

    features.push(
      lim.maxScreens == null
        ? t('marketing.pricing.limits.screensUnlimited')
        : t('marketing.pricing.limits.screens', { n: lim.maxScreens }),
    );
    features.push(
      lim.maxLocations == null
        ? t('marketing.pricing.limits.locationsUnlimited')
        : t('marketing.pricing.limits.locations', { n: lim.maxLocations }),
    );
    features.push(
      lim.maxUsers == null
        ? t('marketing.pricing.limits.usersUnlimited')
        : t('marketing.pricing.limits.users', { n: lim.maxUsers }),
    );
    features.push(
      lim.storageGb == null
        ? t('marketing.pricing.limits.storageUnlimited')
        : t('marketing.pricing.limits.storage', { n: lim.storageGb }),
    );

    features.push(t('marketing.pricing.limits.playlists'));
    features.push(t('marketing.pricing.limits.monitoring'));
    features.push(t('marketing.pricing.limits.offline'));
    features.push(t('marketing.pricing.limits.bilingual'));

    if (plan.code === 'business' || plan.code === 'enterprise') {
      features.push(t('marketing.pricing.limits.support'));
    }
    if (plan.code === 'enterprise') {
      features.push(t('marketing.pricing.limits.onboarding'));
    }

    return features;
  };

  return (
    <main className="bg-white">
      {/* Compact dark hero */}
      <section className="bg-[#0B1220] py-20 text-white sm:py-24">
        <Container>
          <Reveal className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-white/90">
              <Sparkles className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />
              {t('marketing.pricing.title')}
            </span>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
              {t('marketing.pricing.title')}
            </h1>
            <p className="text-lg leading-relaxed text-slate-300">
              {t('marketing.pricing.subtitle')}
            </p>
          </Reveal>
        </Container>
      </section>

      {/* Plans */}
      <section className="py-20 sm:py-24">
        <Container>
          {/* Billing toggle */}
          <Reveal className="mb-12 flex flex-col items-center gap-3">
            <div
              role="group"
              aria-label={t('marketing.pricing.title')}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-[#F8FAFC] p-1 shadow-sm"
            >
              <button
                type="button"
                onClick={() => setBilling('monthly')}
                aria-pressed={billing === 'monthly'}
                className={
                  'rounded-full px-5 py-2 text-sm font-semibold transition ' +
                  (billing === 'monthly'
                    ? 'bg-white text-[#0B1220] shadow-sm'
                    : 'text-[#64748B] hover:text-[#0B1220]')
                }
              >
                {t('marketing.pricing.monthly')}
              </button>
              <button
                type="button"
                onClick={() => setBilling('yearly')}
                aria-pressed={billing === 'yearly'}
                className={
                  'rounded-full px-5 py-2 text-sm font-semibold transition ' +
                  (billing === 'yearly'
                    ? 'bg-white text-[#0B1220] shadow-sm'
                    : 'text-[#64748B] hover:text-[#0B1220]')
                }
              >
                {t('marketing.pricing.yearly')}
              </button>
            </div>
            <span className="inline-flex items-center gap-2 text-sm font-medium text-[#10B981]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {t('marketing.pricing.saveHint')}
            </span>
          </Reveal>

          {/* States */}
          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <Spinner className="h-8 w-8 text-[#2563EB]" />
            </div>
          ) : error ? (
            <Reveal className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-6 py-12 text-center">
              <p className="text-base font-medium text-[#0B1220]">
                {t('marketing.pricing.loadError')}
              </p>
              <Button
                onClick={() => void load()}
                className="bg-[#2563EB] text-white hover:bg-[#1d4fd7]"
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                {t('common.refresh')}
              </Button>
            </Reveal>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
              {plans.map((plan, i) => {
                const popular = plan.code === 'business';
                const custom = isCustom(plan);
                const yearlyPrice = plan.priceYearly ?? plan.priceMonthly * 12;

                return (
                  <Reveal key={plan.id} delay={i * 60} className="h-full">
                    <Card
                      className={
                        'relative flex h-full flex-col border-slate-200 bg-white text-[#0B1220] ' +
                        (popular ? 'shadow-xl ring-2 ring-[#2563EB] lg:-mt-4 lg:mb-4' : 'shadow-sm')
                      }
                    >
                      {popular ? (
                        <span className="absolute -top-3 start-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[#2563EB] px-4 py-1 text-xs font-semibold text-white shadow-sm rtl:translate-x-1/2">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('marketing.pricing.mostPopular')}
                        </span>
                      ) : null}

                      <div className="flex flex-1 flex-col p-7">
                        {/* Header */}
                        <div className="flex flex-col gap-1.5">
                          <h3 className="font-display text-xl font-bold tracking-tight">
                            {planName(plan)}
                          </h3>
                          <p className="min-h-[40px] text-sm leading-relaxed text-[#64748B]">
                            {planTagline(plan)}
                          </p>
                        </div>

                        {/* Price */}
                        <div className="mt-6 min-h-[76px]">
                          {custom ? (
                            <div className="flex flex-col gap-1">
                              <span className="font-display text-4xl font-bold tracking-tight">
                                {t('marketing.pricing.custom')}
                              </span>
                            </div>
                          ) : billing === 'monthly' ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-baseline gap-1.5">
                                <span className="font-display text-4xl font-bold tracking-tight">
                                  {plan.priceMonthly}
                                </span>
                                <span className="text-sm font-medium text-[#64748B]">
                                  {plan.currency}
                                  {t('marketing.pricing.perMonth')}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-baseline gap-1.5">
                                <span className="font-display text-4xl font-bold tracking-tight">
                                  {yearlyPrice}
                                </span>
                                <span className="text-sm font-medium text-[#64748B]">
                                  {plan.currency}
                                  {t('marketing.pricing.perYear')}
                                </span>
                              </div>
                              <span className="text-xs font-medium text-[#10B981]">
                                {t('marketing.pricing.billedYearly')}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* CTA */}
                        <div className="mt-6">
                          {custom ? (
                            <Link
                              href="/demo"
                              className={
                                'inline-flex h-11 w-full items-center justify-center rounded-md px-6 text-sm font-semibold shadow-sm transition ' +
                                (popular
                                  ? 'bg-[#2563EB] text-white hover:bg-[#1d4fd7]'
                                  : 'border border-[#0B1220]/15 bg-white text-[#0B1220] hover:bg-[#F8FAFC]')
                              }
                            >
                              {t('marketing.pricing.contactSales')}
                            </Link>
                          ) : (
                            <Link
                              href="/trial"
                              className={
                                'inline-flex h-11 w-full items-center justify-center rounded-md px-6 text-sm font-semibold shadow-sm transition ' +
                                (popular
                                  ? 'bg-[#2563EB] text-white hover:bg-[#1d4fd7]'
                                  : 'border border-[#0B1220]/15 bg-white text-[#0B1220] hover:bg-[#F8FAFC]')
                              }
                            >
                              {t('marketing.pricing.choose')}
                            </Link>
                          )}
                        </div>

                        {/* Features */}
                        <div className="mt-7 border-t border-slate-100 pt-6">
                          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                            {t('marketing.pricing.featuresHeading')}
                          </p>
                          <ul className="flex flex-col gap-3">
                            {planFeatures(plan).map((feat, fi) => (
                              <li
                                key={fi}
                                className="flex items-start gap-3 text-sm text-[#1E293B]"
                              >
                                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#10B981]/10 text-[#10B981]">
                                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                </span>
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </Card>
                  </Reveal>
                );
              })}
            </div>
          )}
        </Container>
      </section>
    </main>
  );
}
