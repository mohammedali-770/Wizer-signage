'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import type { Playlist } from '@/lib/types';
import {
  Button,
  Card,
  CardContent,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

export default function NewPlaylistPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DRAFT'>('ACTIVE');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast('A title is required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Playlist>('/playlists', {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
      });
      toast('Playlist created.', 'success');
      router.push(`/company/playlists/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create playlist.', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/company/playlists"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to playlists
      </Link>
      <PageHeader
        title="New playlist"
        description="Name your playlist, then add content on the next screen."
      />

      <Card>
        <CardContent className="space-y-4">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lobby loop"
              maxLength={200}
            />
          </Field>
          <Field label="Description" hint="Optional.">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DRAFT')}
            >
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => router.push('/company/playlists')}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : 'Create playlist'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
