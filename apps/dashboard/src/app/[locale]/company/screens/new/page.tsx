'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ServerSearchSelect } from '@/components/server-search-select';
import { api, ApiError } from '@/lib/api';
import type { Orientation, Screen, ScreenUse, WorkingHours } from '@/lib/types';
import { useRouter, Link } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const USE_OPTIONS: ScreenUse[] = [
  'MENU_LANDSCAPE',
  'OFFERS_PORTRAIT',
  'WAITING_AREA',
  'CASHIER_DISPLAY',
  'ENTRANCE',
  'INDOOR',
  'OUTDOOR',
  'GENERIC',
];

const PIN_RE = /^\d{4,8}$/;

export default function NewScreenPage() {
  const t = useTranslations('pages.screensNew');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const router = useRouter();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [locationId, setLocationId] = useState('');
  const [use, setUse] = useState<'' | ScreenUse>('');
  const [orientation, setOrientation] = useState<Orientation>('LANDSCAPE');

  const [audioEnabled, setAudioEnabled] = useState(false);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);

  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [kioskPin, setKioskPin] = useState('');
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast(t('toast.nameRequired'), 'error');
      return;
    }
    const pin = kioskPin.trim();
    if (pin && !PIN_RE.test(pin)) {
      toast(t('toast.pinInvalid'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        orientation,
        audioEnabled,
        volume,
        muted,
        kioskEnabled,
        autoStartEnabled,
      };
      if (code.trim()) payload.code = code.trim();
      if (description.trim()) payload.description = description.trim();
      if (locationId) payload.locationId = locationId;
      if (use) payload.use = use;
      if (pin) payload.kioskPin = pin;
      if (workingHours) payload.workingHours = workingHours;

      const created = await api.post<Screen>('/screens', payload);
      toast(t('toast.created'), 'success');
      router.push(`/company/screens/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.error'), 'error');
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('sections.details')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tc('name')}>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('placeholders.name')}
                  required
                />
              </Field>
              <Field label={t('fields.code')} hint={t('hints.code')}>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t('placeholders.code')}
                />
              </Field>
            </div>

            <Field label={tc('description')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('placeholders.description')}
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={tc('location')}>
                <ServerSearchSelect
                  type="LOCATION"
                  value={locationId}
                  onChange={setLocationId}
                  emptyLabel={t('options.unassigned')}
                  searchPlaceholder={tc('search')}
                  disabled={saving}
                />
              </Field>
              <Field label={t('fields.use')}>
                <Select value={use} onChange={(e) => setUse(e.target.value as '' | ScreenUse)}>
                  <option value="">{t('options.notSet')}</option>
                  {USE_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {te(`screenUse.${u}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={tc('orientation')}>
                <Select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as Orientation)}
                >
                  {ORIENTATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {te(`orientation.${o}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.audio')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="audio-enabled"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={audioEnabled}
                onChange={(e) => setAudioEnabled(e.target.checked)}
              />
              <Label htmlFor="audio-enabled" className="mb-0">
                {t('audio.enabled')}
              </Label>
            </div>

            <div>
              <Label htmlFor="volume">{t('audio.volume', { value: volume })}</Label>
              <input
                id="volume"
                type="range"
                min={0}
                max={100}
                step={1}
                value={volume}
                disabled={!audioEnabled}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="accent-primary w-full disabled:opacity-50"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="muted"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={muted}
                onChange={(e) => setMuted(e.target.checked)}
              />
              <Label htmlFor="muted" className="mb-0">
                {t('audio.muted')}
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('sections.kiosk')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="kiosk-enabled"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={kioskEnabled}
                onChange={(e) => setKioskEnabled(e.target.checked)}
              />
              <Label htmlFor="kiosk-enabled" className="mb-0">
                {t('kiosk.enabled')}
              </Label>
            </div>

            <Field label={t('fields.kioskPin')} hint={t('hints.kioskPin')}>
              <Input
                type="password"
                autoComplete="off"
                value={kioskPin}
                onChange={(e) => setKioskPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={t('placeholders.kioskPin')}
                inputMode="numeric"
                disabled={!kioskEnabled}
              />
            </Field>

            <div className="flex items-center gap-2">
              <input
                id="auto-start"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={autoStartEnabled}
                onChange={(e) => setAutoStartEnabled(e.target.checked)}
              />
              <Label htmlFor="auto-start" className="mb-0">
                {t('kiosk.autoStart')}
              </Label>
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
            href="/company/screens"
            className="border-border hover:bg-muted inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition"
          >
            {tc('cancel')}
          </Link>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner className="size-4" />}
            {t('createScreen')}
          </Button>
        </div>
      </form>
    </div>
  );
}
