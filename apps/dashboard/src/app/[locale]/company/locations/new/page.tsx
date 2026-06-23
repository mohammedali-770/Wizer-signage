'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import type { Location, WorkingHours } from '@/lib/types';
import { Link, useRouter } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

interface FormState {
  name: string;
  code: string;
  description: string;
  address: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  latitude: string;
  longitude: string;
}

function blankForm(): FormState {
  return {
    name: '',
    code: '',
    description: '',
    address: '',
    city: '',
    region: '',
    country: '',
    timezone: '',
    latitude: '',
    longitude: '',
  };
}

/** Parse a number string into a finite number or null (blank/invalid -> null). */
function numberOrNull(value: string): number | null {
  const raw = value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function NewLocationPage() {
  const t = useTranslations('pages.locationsNew');
  const tc = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(blankForm);
  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast(t('toast.nameRequired'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        description: form.description.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        country: form.country.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
        latitude: numberOrNull(form.latitude) ?? undefined,
        longitude: numberOrNull(form.longitude) ?? undefined,
        workingHours: workingHours ?? undefined,
      };

      const created = await api.post<Location>('/locations', payload);
      toast(t('toast.created'), 'success');
      router.push(`/company/locations/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.error'), 'error');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/company/locations"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        {t('backToLocations')}
      </Link>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tc('name')}>
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder={t('placeholders.name')}
                  required
                />
              </Field>
              <Field label={t('fields.code')} hint={t('hints.code')}>
                <Input
                  value={form.code}
                  onChange={(e) => update('code', e.target.value)}
                  placeholder={t('placeholders.code')}
                />
              </Field>
            </div>

            <Field label={tc('description')}>
              <Textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder={t('placeholders.description')}
                rows={2}
              />
            </Field>

            <Field label={t('fields.address')}>
              <Input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder={t('placeholders.address')}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t('fields.city')}>
                <Input
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder={t('placeholders.city')}
                />
              </Field>
              <Field label={t('fields.region')}>
                <Input
                  value={form.region}
                  onChange={(e) => update('region', e.target.value)}
                  placeholder={t('placeholders.region')}
                />
              </Field>
              <Field label={t('fields.country')}>
                <Input
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  placeholder={t('placeholders.country')}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t('fields.timezone')}>
                <Input
                  value={form.timezone}
                  onChange={(e) => update('timezone', e.target.value)}
                  placeholder="Asia/Riyadh"
                />
              </Field>
              <Field label={t('fields.latitude')}>
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => update('latitude', e.target.value)}
                  placeholder="24.7136"
                />
              </Field>
              <Field label={t('fields.longitude')}>
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => update('longitude', e.target.value)}
                  placeholder="46.6753"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.workingHours')}</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link
            href="/company/locations"
            className="border-border hover:bg-muted inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition"
          >
            {tc('cancel')}
          </Link>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner className="size-4" />}
            {t('createLocation')}
          </Button>
        </div>
      </form>
    </div>
  );
}
