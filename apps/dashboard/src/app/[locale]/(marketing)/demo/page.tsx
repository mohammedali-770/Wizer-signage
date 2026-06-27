'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check } from 'lucide-react';

import { Reveal } from '@/components/marketing/reveal';
import { Container } from '@/components/marketing/ui';
import { PairingMock, StatusDot } from '@/components/marketing/visuals';
import { Card, Field, Input, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';

const INPUT_LIGHT =
  'border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-[#2563EB]/40';

const TRUST_KEYS = ['cloud', 'offline', 'bilingual'] as const;

type FieldErrors = Partial<Record<'name' | 'email', string>>;

export default function DemoPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dialCode, setDialCode] = useState('+966');
  const [screens, setScreens] = useState('');
  const [message, setMessage] = useState('');

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = t('marketing.demo.errors.required');
    if (!email.trim()) next.email = t('marketing.demo.errors.required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = t('marketing.demo.errors.email');
    return next;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    // captcha-ready: render reCAPTCHA/Turnstile here and pass captchaToken

    const body: Record<string, string | number> = {
      name: name.trim(),
      email: email.trim(),
      locale,
    };
    if (company.trim()) body.company = company.trim();
    if (phone.trim()) body.phone = `${dialCode} ${phone.trim()}`;
    if (message.trim()) body.message = message.trim();
    if (screens) body.screens = Number(screens);

    setSubmitting(true);
    try {
      await api.post('/public/demo-request', body);
      setSubmitted(true);
      toast(t('marketing.demo.success.title'), 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('marketing.demo.errors.generic'), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-[#F8FAFC] py-20 sm:py-24">
      <Container>
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left — copy */}
          <Reveal className="flex flex-col gap-8">
            <div className="flex flex-col gap-4">
              <h1 className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                {t('marketing.demo.title')}
              </h1>
              <p className="text-lg leading-relaxed text-slate-600">
                {t('marketing.demo.subtitle')}
              </p>
            </div>

            <ul className="flex flex-col gap-3">
              {TRUST_KEYS.map((key, i) => (
                <Reveal as="li" key={key} delay={i * 60}>
                  <span className="flex items-start gap-3 text-base text-slate-700">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#10B981]/15 text-[#10B981]">
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {t(`marketing.home.trust.items.${key}.title`)}
                  </span>
                </Reveal>
              ))}
            </ul>

            <Reveal delay={200} className="hidden lg:block">
              <PairingMock />
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-slate-500">
                <StatusDot tone="online" /> {t('marketing.home.solution.steps.pair.title')}
              </p>
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
                    {t('marketing.demo.success.title')}
                  </h2>
                  <p className="leading-relaxed text-slate-600">
                    {t('marketing.demo.success.desc')}
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="w-full max-w-lg border-slate-200 bg-white p-6 shadow-xl sm:p-8">
                <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
                  <Field label={t('marketing.demo.fields.name')} error={errors.name}>
                    <Input
                      className={INPUT_LIGHT}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('marketing.demo.placeholders.name')}
                      autoComplete="name"
                      required
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.demo.fields.company')}>
                      <Input
                        className={INPUT_LIGHT}
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder={t('marketing.demo.placeholders.company')}
                        autoComplete="organization"
                      />
                    </Field>
                    <Field label={t('marketing.demo.fields.screens')}>
                      <Input
                        className={INPUT_LIGHT}
                        type="number"
                        min={1}
                        value={screens}
                        onChange={(e) => setScreens(e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <Field label={t('marketing.demo.fields.email')} error={errors.email}>
                      <Input
                        className={INPUT_LIGHT}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('marketing.demo.placeholders.email')}
                        autoComplete="email"
                        required
                      />
                    </Field>
                    <Field label={t('marketing.demo.fields.phone')}>
                      <div className="flex gap-2" dir="ltr">
                        <Select
                          aria-label={t('marketing.demo.fields.phone')}
                          className={`${INPUT_LIGHT} w-28 shrink-0`}
                          value={dialCode}
                          onChange={(e) => setDialCode(e.target.value)}
                        >
                          {COUNTRIES.map((c) => (
                            <option key={c.iso} value={c.dial}>
                              {c.dial} {c.iso}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className={`${INPUT_LIGHT} flex-1`}
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder={t('marketing.demo.placeholders.phone')}
                          autoComplete="tel"
                        />
                      </div>
                    </Field>
                  </div>

                  <Field label={t('marketing.demo.fields.message')}>
                    <Textarea
                      className={INPUT_LIGHT}
                      rows={4}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder={t('marketing.demo.placeholders.message')}
                    />
                  </Field>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2563EB] px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1d4fd7] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Spinner /> {t('marketing.demo.submitting')}
                      </>
                    ) : (
                      t('marketing.demo.submit')
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
