'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Save, ShieldCheck } from 'lucide-react';

import { api, apiFetch, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { CompanySettings, WorkingHours } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import { FallbackContentPicker } from '@/components/content/fallback-content-picker';

interface FormState {
  name: string;
  defaultLocale: string;
  timezone: string;
  heartbeat: string;
  notificationEmails: string;
  defaultWorkingHours: WorkingHours | null;
}

function formFromSettings(s: CompanySettings): FormState {
  return {
    name: s.name ?? '',
    defaultLocale: s.defaultLocale ?? 'en',
    timezone: s.timezone ?? '',
    heartbeat: String(s.defaultHeartbeatIntervalSeconds ?? ''),
    notificationEmails: (s.notificationEmails ?? []).join(', '),
    defaultWorkingHours: s.defaultWorkingHours ?? null,
  };
}

/** Split a comma/whitespace-separated string into a de-duplicated email list. */
function parseEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const email = part.trim();
    if (email && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      out.push(email);
    }
  }
  return out;
}

const PIN_PATTERN = /^\d{4,8}$/;

export default function CompanySettingsPage() {
  const t = useTranslations('pages.companySettings');
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<CompanySettings>('/company-settings');

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  // PIN card state
  const [pin, setPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinClearing, setPinClearing] = useState(false);

  // Fallback content card state
  const [fallbackSaving, setFallbackSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(formFromSettings(data));
  }, [data]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      toast(t('toasts.nameRequired'), 'error');
      return;
    }
    const heartbeatNum = form.heartbeat.trim() === '' ? null : Number(form.heartbeat);
    if (heartbeatNum !== null && (!Number.isFinite(heartbeatNum) || heartbeatNum <= 0)) {
      toast(t('toasts.heartbeatInvalid'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        defaultLocale: form.defaultLocale,
        timezone: form.timezone.trim(),
        notificationEmails: parseEmails(form.notificationEmails),
        defaultWorkingHours: form.defaultWorkingHours,
      };
      if (heartbeatNum !== null) payload.defaultHeartbeatIntervalSeconds = heartbeatNum;

      await api.patch<CompanySettings>('/company-settings', payload);
      toast(t('toasts.saved'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetPin = async () => {
    if (!PIN_PATTERN.test(pin)) {
      toast(t('toasts.pinInvalid'), 'error');
      return;
    }
    setPinSaving(true);
    try {
      await apiFetch<unknown>('/company-settings/kiosk-pin', { method: 'PUT', body: { pin } });
      toast(t('toasts.pinSaved'), 'success');
      setPin('');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setPinSaving(false);
    }
  };

  const handleFallbackChange = async (contentId: string | null) => {
    setFallbackSaving(true);
    try {
      await api.patch<CompanySettings>('/company-settings', { fallbackContentId: contentId });
      toast(contentId ? t('toasts.fallbackUpdated') : t('toasts.fallbackCleared'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setFallbackSaving(false);
    }
  };

  const handleClearPin = async () => {
    setPinClearing(true);
    try {
      await api.del<unknown>('/company-settings/kiosk-pin');
      toast(t('toasts.pinCleared'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setPinClearing(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && !loading && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && data && form && (
        <div className="space-y-6">
          {/* General settings ------------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle>{t('general.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label={t('general.name')}>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
                      placeholder={t('general.namePlaceholder')}
                      required
                    />
                  </Field>
                  <Field label={t('general.language')}>
                    <Select
                      value={form.defaultLocale}
                      onChange={(e) => setForm((f) => f && { ...f, defaultLocale: e.target.value })}
                    >
                      <option value="en">{t('general.languageEn')}</option>
                      <option value="ar">{t('general.languageAr')}</option>
                    </Select>
                  </Field>
                  <Field label={t('general.timezone')} hint={t('general.timezoneHint')}>
                    <Input
                      value={form.timezone}
                      onChange={(e) => setForm((f) => f && { ...f, timezone: e.target.value })}
                      placeholder={t('general.timezonePlaceholder')}
                    />
                  </Field>
                  <Field label={t('general.heartbeat')} hint={t('general.heartbeatHint')}>
                    <Input
                      type="number"
                      min="1"
                      value={form.heartbeat}
                      onChange={(e) => setForm((f) => f && { ...f, heartbeat: e.target.value })}
                      placeholder="60"
                    />
                  </Field>
                </div>

                <Field
                  label={t('general.notificationEmails')}
                  hint={t('general.notificationEmailsHint')}
                >
                  <Input
                    value={form.notificationEmails}
                    onChange={(e) =>
                      setForm((f) => f && { ...f, notificationEmails: e.target.value })
                    }
                    placeholder="ops@acme.com, alerts@acme.com"
                  />
                </Field>

                <div>
                  <Label>{t('general.workingHours')}</Label>
                  <p className="text-muted-foreground mb-3 text-xs">
                    {t('general.workingHoursHint')}
                  </p>
                  <div className="border-border rounded-lg border p-4">
                    <WorkingHoursEditor
                      value={form.defaultWorkingHours}
                      onChange={(wh) => setForm((f) => f && { ...f, defaultWorkingHours: wh })}
                      timezonePlaceholder={form.timezone || t('general.timezonePlaceholder')}
                    />
                  </div>
                </div>

                <div className="border-border flex justify-end border-t pt-4">
                  <Button type="submit" disabled={saving}>
                    {saving ? <Spinner className="size-4" /> : <Save className="size-4" />}
                    {t('general.save')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Fallback content ----------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>{t('fallback.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">{t('fallback.description')}</p>
              <FallbackContentPicker
                value={data.fallbackContentId}
                onChange={handleFallbackChange}
                busy={fallbackSaving}
              />
            </CardContent>
          </Card>

          {/* Default kiosk PIN ---------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>{t('pin.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="text-muted-foreground size-4" aria-hidden />
                {data.hasDefaultKioskPin ? (
                  <Badge tone="success">{t('pin.isSet')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('pin.notSet')}</Badge>
                )}
              </div>

              <p className="text-muted-foreground text-sm">{t('pin.description')}</p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48">
                  <Field
                    label={data.hasDefaultKioskPin ? t('pin.update') : t('pin.set')}
                    hint={t('pin.hint')}
                  >
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      maxLength={8}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                    />
                  </Field>
                </div>
                <Button onClick={handleSetPin} disabled={pinSaving || !pin}>
                  {pinSaving && <Spinner className="size-4" />}
                  {data.hasDefaultKioskPin ? t('pin.update') : t('pin.set')}
                </Button>
                {data.hasDefaultKioskPin && (
                  <Button variant="outline" onClick={handleClearPin} disabled={pinClearing}>
                    {pinClearing && <Spinner className="size-4" />}
                    {t('pin.clear')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Plan (read-only) ----------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>{t('plan.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.plan ? (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="text-muted-foreground size-5" aria-hidden />
                    <div>
                      <p className="text-base font-semibold tracking-tight">{data.plan.name}</p>
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                        {data.plan.code}
                      </code>
                    </div>
                  </div>
                  <StatusBadge status={data.plan.status} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{t('plan.none')}</p>
              )}
              <p className="text-muted-foreground text-sm">{t('plan.managed')}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
