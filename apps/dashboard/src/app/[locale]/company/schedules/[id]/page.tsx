'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Pause, Play, Trash2 } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  Paginated,
  PlaybackManifest,
  Schedule,
  ScheduleType,
  ScheduleValidation,
  Screen,
} from '@/lib/types';
import { formatDate, formatDateTime, formatDuration } from '@/lib/format';
import { DaysOfWeekField } from '@/components/schedules/days-of-week-field';
import { TargetSelector, type SelectedTarget } from '@/components/schedules/target-selector';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduleDetailPage() {
  const t = useTranslations('pages.scheduleDetail');
  const tc = useTranslations('common');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();

  const {
    data: schedule,
    loading,
    error,
    reload,
  } = useApiResource<Schedule>(id ? `/schedules/${id}` : null);
  const validation = useApiResource<ScheduleValidation>(id ? `/schedules/${id}/validate` : null);
  const screens = useApiResource<Paginated<Screen>>('/screens?pageSize=100');

  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewScreenId, setPreviewScreenId] = useState('');
  const [manifest, setManifest] = useState<PlaybackManifest | null>(null);
  const [manifestBusy, setManifestBusy] = useState(false);

  const reloadAll = () => {
    reload();
    validation.reload();
  };

  const run = async (fn: () => Promise<unknown>, ok?: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      reloadAll();
      after?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const loadManifest = async () => {
    if (!previewScreenId) return;
    setManifestBusy(true);
    try {
      setManifest(await api.get<PlaybackManifest>(`/screens/${previewScreenId}/playback-manifest`));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.manifestError'), 'error');
    } finally {
      setManifestBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }
  if (error || !schedule) {
    return <EmptyState title={t('notFound')} description={error ?? undefined} />;
  }

  const targets: SelectedTarget[] = schedule.targets.map((t) => ({
    targetType: t.targetType,
    targetId: t.targetId,
  }));

  return (
    <div>
      <Link
        href="/company/schedules"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {t('backToSchedules')}
      </Link>

      <PageHeader
        title={schedule.name}
        description={schedule.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)} disabled={busy}>
              {tc('edit')}
            </Button>
            {schedule.status !== 'ACTIVE' ? (
              <Button
                variant="outline"
                onClick={() => run(() => api.post(`/schedules/${id}/resume`), t('toast.resumed'))}
                disabled={busy}
              >
                <Play className="size-4" /> {t('actions.resume')}
              </Button>
            ) : null}
            {schedule.status === 'ACTIVE' ? (
              <Button
                variant="outline"
                onClick={() => run(() => api.post(`/schedules/${id}/pause`), t('toast.paused'))}
                disabled={busy}
              >
                <Pause className="size-4" /> {t('actions.pause')}
              </Button>
            ) : null}
            {schedule.status !== 'ARCHIVED' ? (
              <Button
                variant="outline"
                onClick={() => run(() => api.post(`/schedules/${id}/archive`), t('toast.archived'))}
                disabled={busy}
              >
                {t('actions.archive')}
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge
          tone={
            schedule.status === 'ACTIVE'
              ? 'success'
              : schedule.status === 'PAUSED'
                ? 'warning'
                : 'neutral'
          }
        >
          {t(`statuses.${schedule.status}`)}
        </Badge>
        <Badge tone={schedule.scheduleType === 'CAMPAIGN' ? 'info' : 'neutral'}>
          {t(`types.${schedule.scheduleType}`)}
        </Badge>
        <Badge tone="neutral">{t('priorityValue', { value: schedule.priority })}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('cards.playlistTiming')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t('fields.playlist')}>
              {schedule.playlist ? (
                <Link
                  href={`/company/playlists/${schedule.playlist.id}`}
                  className="text-primary hover:underline"
                >
                  {schedule.playlist.title}
                </Link>
              ) : (
                <span className="text-muted-foreground">{t('values.none')}</span>
              )}
            </Row>
            <Row label={t('fields.dates')}>
              {schedule.startDate ? formatDate(schedule.startDate, locale) : '—'}
              {schedule.endDate
                ? ` → ${formatDate(schedule.endDate, locale)}`
                : ` → ${t('values.openEnded')}`}
            </Row>
            <Row label={t('fields.time')}>
              {schedule.isAllDay
                ? t('values.allDay')
                : `${schedule.startTime ?? '—'} – ${schedule.endTime ?? '—'}`}
            </Row>
            <Row label={t('fields.days')}>
              {schedule.daysOfWeek.length
                ? schedule.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')
                : t('values.everyDay')}
            </Row>
            <Row label={t('fields.timezone')}>
              {schedule.timezone ?? t('values.screenLocationDefault')}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('targets.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetSelector
              targets={targets}
              busy={busy}
              onAdd={(target) =>
                run(
                  () =>
                    api.post(
                      `/schedules/${id}/targets`,
                      target.targetType === 'COMPANY' ? { targetType: 'COMPANY' } : target,
                    ),
                  t('toast.targetAdded'),
                )
              }
              onRemove={(_t, i) => {
                const target = schedule.targets[i];
                if (target)
                  run(
                    () => api.del(`/schedules/${id}/targets/${target.id}`),
                    t('toast.targetRemoved'),
                  );
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Validation + warnings */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('validation.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {validation.loading ? (
            <Spinner className="text-primary size-4" />
          ) : validation.data ? (
            <>
              <div className="flex items-center gap-2">
                {validation.data.schedulable ? (
                  <Badge tone="success">{t('validation.readyToPlay')}</Badge>
                ) : (
                  <Badge tone="warning">{t('validation.notPlayableYet')}</Badge>
                )}
              </div>
              {validation.data.warnings.length > 0 ? (
                <ul className="space-y-1">
                  {validation.data.warnings.map((w) => (
                    <li key={w} className="text-amber-700 dark:text-amber-300">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">{t('validation.noWarnings')}</p>
              )}
              {validation.data.conflicts.length > 0 ? (
                <div>
                  <p className="font-medium">{t('validation.overlapping')}</p>
                  <ul className="mt-1 space-y-1">
                    {validation.data.conflicts.map((c) => (
                      <li key={c.scheduleId} className="text-muted-foreground">
                        <Link
                          href={`/company/schedules/${c.scheduleId}`}
                          className="text-primary hover:underline"
                        >
                          {c.name}
                        </Link>{' '}
                        — {t('validation.sharedScreens', { count: c.sharedScreenIds.length })}{' '}
                        {c.winnerId === schedule.id ? (
                          <Badge tone="success">{t('validation.thisWins')}</Badge>
                        ) : (
                          <Badge tone="warning">{t('validation.otherWins')}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Manifest preview */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Select
              value={previewScreenId}
              onChange={(e) => setPreviewScreenId(e.target.value)}
              className="w-64"
            >
              <option value="">{t('preview.selectScreen')}</option>
              {screens.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              onClick={loadManifest}
              disabled={!previewScreenId || manifestBusy}
            >
              {manifestBusy ? <Spinner className="size-4" /> : t('preview.resolveNow')}
            </Button>
          </div>

          {manifest ? (
            <div className="border-border rounded-lg border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    manifest.sourceType === 'SCHEDULE'
                      ? 'success'
                      : manifest.sourceType === 'FALLBACK'
                        ? 'info'
                        : 'neutral'
                  }
                >
                  {t(`preview.sourceType.${manifest.sourceType}`)}
                </Badge>
                {manifest.scheduleName ? <span>{manifest.scheduleName}</span> : null}
                {manifest.playlistTitle ? (
                  <span className="text-muted-foreground">· {manifest.playlistTitle}</span>
                ) : null}
                {manifest.outsideHours ? (
                  <Badge tone="warning">
                    {t('preview.outsideHours', { behavior: manifest.outsideHoursBehavior })}
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('preview.resolvedAt', {
                  time: formatDateTime(manifest.generatedAt, locale),
                  timezone: manifest.timezone,
                })}
              </p>
              {manifest.items.length > 0 ? (
                <ol className="mt-3 list-decimal space-y-1 ps-5">
                  {manifest.items.map((item, i) => (
                    <li key={`${item.contentId}-${i}`}>
                      {item.title} <Badge tone="neutral">{item.type}</Badge>{' '}
                      <span className="text-muted-foreground">
                        {item.playFullVideo
                          ? t('preview.fullVideo')
                          : formatDuration(item.durationSeconds, locale)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-muted-foreground mt-3">
                  {t('preview.noItems')}
                  {manifest.message ? ` — ${manifest.message}` : ''}.
                </p>
              )}
              {manifest.warnings.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {manifest.warnings.map((w) => (
                    <li key={w} className="text-xs text-amber-700 dark:text-amber-300">
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {editOpen ? (
        <ScheduleEditDialog
          schedule={schedule}
          busy={busy}
          onClose={() => setEditOpen(false)}
          onSave={(body) =>
            run(
              () => api.patch(`/schedules/${id}`, body),
              t('toast.updated'),
              () => setEditOpen(false),
            )
          }
        />
      ) : null}

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('deleteDialog.title')}
        description={t('deleteDialog.description')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              run(
                () => api.del(`/schedules/${id}`),
                t('toast.deleted'),
                () => router.push('/company/schedules'),
              )
            }
            disabled={busy}
          >
            {tc('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

function ScheduleEditDialog({
  schedule,
  busy,
  onClose,
  onSave,
}: {
  schedule: Schedule;
  busy?: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('pages.scheduleDetail');
  const tc = useTranslations('common');
  const [name, setName] = useState(schedule.name);
  const [description, setDescription] = useState(schedule.description ?? '');
  const [scheduleType, setScheduleType] = useState<ScheduleType>(schedule.scheduleType);
  const [priority, setPriority] = useState(String(schedule.priority));
  const [startDate, setStartDate] = useState(
    schedule.startDate ? schedule.startDate.slice(0, 10) : '',
  );
  const [endDate, setEndDate] = useState(schedule.endDate ? schedule.endDate.slice(0, 10) : '');
  const [isAllDay, setIsAllDay] = useState(schedule.isAllDay);
  const [startTime, setStartTime] = useState(schedule.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(schedule.endTime ?? '17:00');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(schedule.daysOfWeek);

  const isoFrom = (d: string) => new Date(`${d}T00:00:00Z`).toISOString();

  const save = () =>
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      scheduleType,
      priority: Number(priority) || 0,
      startDate: startDate ? isoFrom(startDate) : undefined,
      endDate: endDate ? isoFrom(endDate) : null,
      isAllDay,
      startTime: isAllDay ? null : startTime,
      endTime: isAllDay ? null : endTime,
      daysOfWeek,
    });

  return (
    <Dialog open onClose={onClose} title={t('editDialog.title')} className="max-w-xl">
      <div className="space-y-4">
        <Field label={tc('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label={tc('description')}>
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
              <option value="NORMAL">{t('types.NORMAL')}</option>
              <option value="CAMPAIGN">{t('types.CAMPAIGN')}</option>
            </Select>
          </Field>
          <Field label={t('fields.priority')}>
            <Input
              type="number"
              min={0}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fields.startDate')}>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
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
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fields.startTime')}>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label={t('fields.endTime')}>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label={t('fields.daysOfWeek')}>
          <DaysOfWeekField value={daysOfWeek} onChange={setDaysOfWeek} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button onClick={save} disabled={busy}>
            {tc('save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
