'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  Paginated,
  PlaylistListItem,
  Schedule,
  ScheduleStatus,
  ScheduleType,
} from '@/lib/types';
import { DaysOfWeekField } from '@/components/schedules/days-of-week-field';
import { TargetSelector, type SelectedTarget } from '@/components/schedules/target-selector';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

function dateToIso(value: string): string | undefined {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00Z`).toISOString();
}

export default function NewSchedulePage() {
  const t = useTranslations('pages.schedulesNew');
  const tc = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const playlists = useApiResource<Paginated<PlaylistListItem>>(
    '/playlists?status=ACTIVE&pageSize=100',
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('NORMAL');
  const [status, setStatus] = useState<ScheduleStatus>('ACTIVE');
  const [priority, setPriority] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [timezone, setTimezone] = useState('');
  const [targets, setTargets] = useState<SelectedTarget[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast(t('toast.nameRequired'), 'error');
    if (!startDate) return toast(t('toast.startDateRequired'), 'error');
    if (!isAllDay && (!startTime || !endTime)) return toast(t('toast.timeRequired'), 'error');

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      playlistId: playlistId || undefined,
      scheduleType,
      status,
      priority: Number(priority) || 0,
      startDate: dateToIso(startDate),
      endDate: dateToIso(endDate),
      isAllDay,
      startTime: isAllDay ? undefined : startTime,
      endTime: isAllDay ? undefined : endTime,
      daysOfWeek,
      timezone: timezone.trim() || undefined,
      targets: targets.map((t) => (t.targetType === 'COMPANY' ? { targetType: 'COMPANY' } : t)),
    };

    setSaving(true);
    try {
      const created = await api.post<Schedule>('/schedules', payload);
      toast(t('toast.created'), 'success');
      router.push(`/company/schedules/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.createError'), 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/company/schedules"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {t('backToSchedules')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('details.title')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={tc('name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </Field>
            <Field label={t('fields.playlist')}>
              <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                <option value="">{t('fields.noneYet')}</option>
                {playlists.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={tc('description')} hint={t('hints.optional')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tc('type')}>
                <Select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                >
                  <option value="NORMAL">{t('types.normal')}</option>
                  <option value="CAMPAIGN">{t('types.campaign')}</option>
                </Select>
              </Field>
              <Field label={t('fields.priority')} hint={t('hints.higherWins')}>
                <Input
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </Field>
            </div>
            <Field label={tc('status')}>
              <Select value={status} onChange={(e) => setStatus(e.target.value as ScheduleStatus)}>
                <option value="ACTIVE">{t('statuses.active')}</option>
                <option value="PAUSED">{t('statuses.paused')}</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('timing.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('fields.startDate')}>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label={t('fields.endDate')} hint={t('hints.endDate')}>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
              />
              {t('fields.allDay')}
            </label>
            {!isAllDay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('fields.startTime')}>
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </Field>
                <Field label={t('fields.endTime')} hint={t('hints.endTime')}>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <Field label={t('fields.daysOfWeek')}>
              <DaysOfWeekField value={daysOfWeek} onChange={setDaysOfWeek} />
            </Field>
            <Field label={t('fields.timezone')} hint={t('hints.timezone')}>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder={t('placeholders.timezone')}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('targets.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetSelector
              targets={targets}
              onAdd={(t) => setTargets((prev) => [...prev, t])}
              onRemove={(_t, i) => setTargets((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/company/schedules')}
            disabled={saving}
          >
            {tc('cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : t('createSchedule')}
          </Button>
        </div>
      </div>
    </div>
  );
}
