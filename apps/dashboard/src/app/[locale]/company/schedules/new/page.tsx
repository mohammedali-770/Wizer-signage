'use client';

import { useState } from 'react';
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
    if (!name.trim()) return toast('A name is required.', 'error');
    if (!startDate) return toast('A start date is required.', 'error');
    if (!isAllDay && (!startTime || !endTime))
      return toast('Start and end time are required unless all-day.', 'error');

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
      toast('Schedule created.', 'success');
      router.push(`/company/schedules/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create schedule.', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/company/schedules"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to schedules
      </Link>
      <PageHeader
        title="New schedule"
        description="Assign a playlist to screens with timing and priority."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Playlist">
              <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                <option value="">— none yet —</option>
                {playlists.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" hint="Optional.">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <Select
                  value={scheduleType}
                  onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                >
                  <option value="NORMAL">Normal</option>
                  <option value="CAMPAIGN">Campaign</option>
                </Select>
              </Field>
              <Field label="Priority" hint="Higher wins.">
                <Input
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as ScheduleStatus)}>
                <option value="ACTIVE">Active (needs playlist + targets)</option>
                <option value="PAUSED">Paused</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="End date" hint="Optional; open-ended if blank.">
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
              />
              All day
            </label>
            {!isAllDay ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start time">
                  <Input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </Field>
                <Field label="End time" hint="An end before start means overnight.">
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </Field>
              </div>
            ) : null}
            <Field label="Days of week">
              <DaysOfWeekField value={daysOfWeek} onChange={setDaysOfWeek} />
            </Field>
            <Field
              label="Timezone"
              hint="Optional; defaults to the screen / location / company timezone."
            >
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Asia/Riyadh"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Targets</CardTitle>
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
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : 'Create schedule'}
          </Button>
        </div>
      </div>
    </div>
  );
}
