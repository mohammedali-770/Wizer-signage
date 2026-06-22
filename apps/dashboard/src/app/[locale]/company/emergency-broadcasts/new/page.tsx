'use client';

import { useState } from 'react';
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
    if (!title.trim()) return toast('A title is required.', 'error');
    if (broadcastType === 'TEXT' && !message.trim())
      return toast('A message is required for a text broadcast.', 'error');
    if (broadcastType === 'URL' && !url.trim())
      return toast('A URL is required for a URL broadcast.', 'error');
    if (broadcastType === 'CONTENT' && !contentId)
      return toast('Select the content to broadcast.', 'error');
    if (broadcastType === 'PLAYLIST' && !playlistId)
      return toast('Select the playlist to broadcast.', 'error');

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
      toast('Draft broadcast created. Activate it to go live.', 'success');
      router.push(`/company/emergency-broadcasts/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create broadcast.', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/company/emergency-broadcasts"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to broadcasts
      </Link>
      <PageHeader
        title="New emergency broadcast"
        description="Created as a draft — review, then activate to override schedules."
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Type">
              <Select
                value={broadcastType}
                onChange={(e) => setBroadcastType(e.target.value as EmergencyBroadcastType)}
              >
                <option value="TEXT">Text message</option>
                <option value="CONTENT">Library content</option>
                <option value="PLAYLIST">Playlist</option>
                <option value="URL">External URL</option>
              </Select>
            </Field>
            <Field label="Description" hint="Optional (internal note).">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={1000}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority" hint="Higher wins between emergencies.">
                <Input
                  type="number"
                  min={0}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </Field>
              <Field label="Auto-end at" hint="Optional.">
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
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {broadcastType === 'TEXT' ? (
              <Field label="Message">
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </Field>
            ) : broadcastType === 'URL' ? (
              <Field label="URL">
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  maxLength={2000}
                />
              </Field>
            ) : broadcastType === 'CONTENT' ? (
              <Field label="Content" hint="Only ACTIVE content can be broadcast.">
                <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
                  <option value="">Select…</option>
                  {contents.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Playlist" hint="Only ACTIVE playlists can be broadcast.">
                <Select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
                  <option value="">Select…</option>
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
            onClick={() => router.push('/company/emergency-broadcasts')}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? <Spinner className="size-4" /> : 'Create draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
