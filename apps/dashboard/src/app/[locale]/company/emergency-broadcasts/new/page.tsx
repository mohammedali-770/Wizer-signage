'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  Content,
  EmergencyBroadcast,
  EmergencyBroadcastType,
  Paginated,
  PlaylistListItem,
} from '@/lib/types';
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

export default function NewEmergencyBroadcastPage() {
  const t = useTranslations('pages.emergency.new');
  const tt = useTranslations('pages.emergency.types');
  const tc = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const contents = useApiResource<Paginated<Content>>('/content?status=ACTIVE&pageSize=100');
  const playlists = useApiResource<Paginated<PlaylistListItem>>(
    '/playlists?status=ACTIVE&pageSize=100',
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [broadcastType, setBroadcastType] = useState<EmergencyBroadcastType>('TEXT');
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const [contentId, setContentId] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [priority, setPriority] = useState('100');
  const [endAt, setEndAt] = useState('');
  const [targets, setTargets] = useState<SelectedTarget[]>([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast(t('errTitle'), 'error');
    if (broadcastType === 'TEXT' && !message.trim()) return toast(t('errMessage'), 'error');
    if (broadcastType === 'URL' && !url.trim()) return toast(t('errUrl'), 'error');
    if (broadcastType === 'CONTENT' && !contentId) return toast(t('errContent'), 'error');
    if (broadcastType === 'PLAYLIST' && !playlistId) return toast(t('errPlaylist'), 'error');

    const payload = {
      title: title.trim(),
      description: description.trim() || undefined,
      broadcastType,
      message: broadcastType === 'TEXT' ? message.trim() : undefined,
      url: broadcastType === 'URL' ? url.trim() : undefined,
      contentId: broadcastType === 'CONTENT' ? contentId : undefined,
      playlistId: broadcastType === 'PLAYLIST' ? playlistId : undefined,
      priority: Number(priority) || 100,
      endAt: endAt ? new Date(endAt).toISOString() : undefined,
      targets: targets.map((t) =>
        t.targetType === 'COMPANY' ? { targetType: 'COMPANY', targetId: 'company' } : t,
      ),
    };

    setSaving(true);
    try {
      const created = await api.post<EmergencyBroadcast>('/emergency-broadcasts', payload);
      toast(t('createdToast'), 'success');
      router.push(`/company/emergency-broadcasts/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errCreate'), 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/company/emergency-broadcasts"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {t('back')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label={tc('name')}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
            <Field label={tc('type')}>
              <Select
                value={broadcastType}
                onChange={(e) => setBroadcastType(e.target.value as EmergencyBroadcastType)}
              >
                <option value="TEXT">{tt('TEXT')}</option>
                <option value="CONTENT">{tt('CONTENT')}</option>
                <option value="PLAYLIST">{tt('PLAYLIST')}</option>
                <option value="URL">{tt('URL')}</option>
              </Select>
            </Field>
            <Field label={tc('description')} hint={t('descriptionHint')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('priorityLabel')} hint={t('priorityHint')}>
                <Input
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </Field>
              <Field label={t('autoEndLabel')} hint={t('autoEndHint')}>
                <Input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('contentTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {broadcastType === 'TEXT' ? (
              <Field label={t('messageLabel')}>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            ) : broadcastType === 'URL' ? (
              <Field label={t('urlLabel')}>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  maxLength={2000}
                />
              </Field>
            ) : broadcastType === 'CONTENT' ? (
              <Field label={t('contentLabel')} hint={t('contentHint')}>
                <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
                  <option value="">{t('selectPlaceholder')}</option>
                  {contents.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label={t('playlistLabel')} hint={t('playlistHint')}>
                <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  <option value="">{t('selectPlaceholder')}</option>
                  {playlists.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('targetsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TargetSelector
              targets={targets}
              onAdd={(target) => setTargets((prev) => [...prev, target])}
              onRemove={(_t, i) => setTargets((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/company/emergency-broadcasts')}
            disabled={saving}
          >
            {tc('cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : t('createDraft')}
          </Button>
        </div>
      </div>
    </div>
  );
}
