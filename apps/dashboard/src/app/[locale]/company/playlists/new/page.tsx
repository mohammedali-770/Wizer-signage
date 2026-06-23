'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.playlistsNew');
  const tc = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'DRAFT'>('ACTIVE');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      toast(t('titleRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const created = await api.post<Playlist>('/playlists', {
        title: title.trim(),
        description: description.trim() || undefined,
        status,
      });
      toast(t('createdToast'), 'success');
      router.push(`/company/playlists/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('createError'), 'error');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/company/playlists"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {t('backToPlaylists')}
      </Link>
      <PageHeader title={t('title')} description={t('description')} />

      <Card>
        <CardContent className="space-y-4">
          <Field label={t('titleLabel')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('titlePlaceholder')}
              maxLength={200}
            />
          </Field>
          <Field label={tc('description')} hint={t('optionalHint')}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </Field>
          <Field label={tc('status')}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DRAFT')}
            >
              <option value="ACTIVE">{t('statusActive')}</option>
              <option value="DRAFT">{t('statusDraft')}</option>
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => router.push('/company/playlists')}
              disabled={saving}
            >
              {tc('cancel')}
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Spinner className="size-4" /> : t('createButton')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
