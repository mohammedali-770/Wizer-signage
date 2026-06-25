'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Check, Sparkles, ShieldCheck, Clock } from 'lucide-react';

import { Reveal } from '@/components/marketing/reveal';
import { Container } from '@/components/marketing/ui';
import { DashboardMockup, StatusDot } from '@/components/marketing/visuals';
import { Card, Field, Input, Select, Spinner, useToast } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';

// Shared light styling so the form stays brand-light regardless of theme tokens.
const INPUT_LIGHT =
  'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-[#2563EB]/40';

const BUSINESS_TYPES = [
  'restaurant',
  'cafe',
  'retail',
  'clinic',
  'gym',
  'school',
  'office',
  'hotel',
  'franchise',
  'other',
] as const;

type FieldErrors = Partial<
  Record<'fullName' | 'companyName' | 'email' | 'password' | 'confirmPassword', string>
>;

export default function TrialPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [branches, setBranches] = useState('');
  const [screens, setScreens] = useState('');
  const [language, setLanguage] = useState(locale === 'ar' ? 'ar' : 'en');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const benefits = t.raw('marketing.trial.benefits') as string[];

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!fullName.trim()) next.fullName = t('marketing.trial.errors.required');
    if (!companyName.trim()) next.companyName = t('marketing.trial.errors.required');
    if (!email.trim()) next.email = t('marketing.trial.errors.required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = t('marketing.trial.errors.email');
    if (!password) next.password = t('marketing.trial.errors.required');
    else if (password.length < 10) next.password = t('marketing.trial.errors.passwordShort');
    if (!confirmPassword) next.confirmPassword = t('marketing.trial.errors.required');
    else if (password !== confirmPassword)
      next.confirmPassword = t('marketing.trial.errors.passwordMismatch');
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    // captcha-ready: render reCAPTCHA/Turnstile here and pass captchaToken

    const body: Record<string, string | number> = {
      fullName: fullName.trim(),
      companyName: companyName.trim(),
      email: email.trim(),
      password,
      preferredLanguage: language,
    };
    if (phone.trim()) body.phone = phone.trim();
    if (country.trim()) body.country = country.trim();
    if (city.trim()) body.city = city.trim();
    if (businessType) body.businessType = businessType;
    if (branches) body.branches = Number(branches);
    if (screens) body.screens = Number(screens);

    setSubmitting(true);
    try {
      await api.post('/public/trial-signup', body);
      setSubmitted(true);
      toast(t('marketing.trial.success.title'), 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(t('marketing.trial.errors.duplicate'), 'error');
      } else {
        toast(err instanceof ApiError ? err.message : t('marketing.trial.errors.generic'), 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-[#F8FAFC] py-20 sm:py-24">
      <Container>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left — marketing copy */}
          <Reveal className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#2563EB]/10 px-3 py-1 text-sm font-semibold text-[#2563EB]">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {t('marketing.trial.subtitle')}
              </span>
              <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                {t('marketing.trial.title')}
              </h1>
            </div>

            <ul className="flex flex-col gap-3">
              {benefits.map((benefit, i) => (
                <Reveal as="li" key={benefit} delay={i * 60}>
                  <span className="flex items-start gap-3 text-base text-slate-700">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#10B981]/15 text-[#10B981]">
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {benefit}
                  </span>
                </Reveal>
              ))}
            </ul>

            <Reveal delay={240} className="relative hidden lg:block">
              <DashboardMockup />
              <div className="mt-4 flex items-center gap-6 text-sm text-slate-500">
                <span className="inline-flex items-center gap-2">
                  <StatusDot tone="online" /> {t('marketing.trial.languages.en')} ·{' '}
                  {t('marketing.trial.languages.ar')}
                </span>
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-4 w-4 text-[#2563EB]" aria-hidden="true" /> 14d
                </span>
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#2563EB]" aria-hidden="true" /> SaaS
                </span>
              </div>
            </Reveal>
          </Reveal>

          {/* Right — form / success */}
          <Reveal delay={120} className="lg:justify-self-end">
            {submitted ? (
              <Card className="w-full max-w-lg border-slate-200 bg-white p-8 shadow-xl">
                <div className="flex flex-col items-center gap-5 text-center">
                  <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#10B981]/15 text-[#10B981]">
                    <Check className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <h2 className="font-display text-2xl font-bold text-slate-900">
                    {t('marketing.trial.success.title')}
                  </h2>
                  <p className="leading-relaxed text-slate-600">
                    {t('marketing.trial.success.desc')}
                  </p>
                  <Link
                    href="/login"
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7]"
                  >
                    {t('marketing.trial.success.cta')}
                  </Link>
                </div>
              </Card>
            ) : (
              <Card className="w-full max-w-lg border-slate-200 bg-white p-6 shadow-xl sm:p-8">
                <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.trial.fields.fullName')} error={errors.fullName}>
                      <Input
                        className={INPUT_LIGHT}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={t('marketing.trial.placeholders.fullName')}
                        autoComplete="name"
                        required
                      />
                    </Field>
                    <Field
                      label={t('marketing.trial.fields.companyName')}
                      error={errors.companyName}
                    >
                      <Input
                        className={INPUT_LIGHT}
                        value={companyName}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder={t('marketing.trial.placeholders.companyName')}
                        autoComplete="organization"
                        required
                      />
                    </Field>
                  </div>

                  <Field label={t('marketing.trial.fields.email')} error={errors.email}>
                    <Input
                      className={INPUT_LIGHT}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('marketing.trial.placeholders.email')}
                      autoComplete="email"
                      required
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.trial.fields.phone')}>
                      <Input
                        className={INPUT_LIGHT}
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder={t('marketing.trial.placeholders.phone')}
                        autoComplete="tel"
                      />
                    </Field>
                    <Field label={t('marketing.trial.fields.businessType')}>
                      <Select
                        className={INPUT_LIGHT}
                        value={businessType}
                        onChange={(e) => setBusinessType(e.target.value)}
                      >
                        <option value="" />
                        {BUSINESS_TYPES.map((bt) => (
                          <option key={bt} value={bt}>
                            {t(`marketing.trial.businessTypes.${bt}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.trial.fields.country')}>
                      <Input
                        className={INPUT_LIGHT}
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        autoComplete="country-name"
                      />
                    </Field>
                    <Field label={t('marketing.trial.fields.city')}>
                      <Input
                        className={INPUT_LIGHT}
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        placeholder={t('marketing.trial.placeholders.city')}
                        autoComplete="address-level2"
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.trial.fields.branches')}>
                      <Input
                        className={INPUT_LIGHT}
                        type="number"
                        min={1}
                        value={branches}
                        onChange={(e) => setBranches(e.target.value)}
                      />
                    </Field>
                    <Field label={t('marketing.trial.fields.screens')}>
                      <Input
                        className={INPUT_LIGHT}
                        type="number"
                        min={1}
                        value={screens}
                        onChange={(e) => setScreens(e.target.value)}
                      />
                    </Field>
                  </div>

                  <Field label={t('marketing.trial.fields.language')}>
                    <Select
                      className={INPUT_LIGHT}
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="en">{t('marketing.trial.languages.en')}</option>
                      <option value="ar">{t('marketing.trial.languages.ar')}</option>
                    </Select>
                  </Field>

                  <Field
                    label={t('marketing.trial.fields.password')}
                    hint={t('marketing.trial.passwordHint')}
                    error={errors.password}
                  >
                    <Input
                      className={INPUT_LIGHT}
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </Field>

                  <Field
                    label={t('marketing.trial.fields.confirmPassword')}
                    error={errors.confirmPassword}
                  >
                    <Input
                      className={INPUT_LIGHT}
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Spinner /> {t('marketing.trial.submitting')}
                      </>
                    ) : (
                      t('marketing.trial.submit')
                    )}
                  </button>
                </form>
              </Card>
            )}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
