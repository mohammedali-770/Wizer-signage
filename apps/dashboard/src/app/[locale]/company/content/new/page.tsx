'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, FileText, Link2, Upload } from 'lucide-react';

import { ServerSearchMultiSelect } from '@/components/server-search-multi-select';
import { api, ApiError } from '@/lib/api';
import type { Content, Orientation } from '@/lib/types';
import type { SelectorEntity } from '@/lib/selector-search';
import { Link, useRouter } from '@/i18n/navigation';
import {
  Button,
  Card,
  CardContent,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

type Mode = 'upload' | 'url' | 'text';

const MODES: { value: Mode; icon: typeof Upload }[] = [
  { value: 'upload', icon: Upload },
  { value: 'url', icon: Link2 },
  { value: 'text', icon: FileText },
];

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const FILE_ACCEPT = 'image/*,video/*,application/pdf';

/** Convert a `type=date` value (YYYY-MM-DD) to an ISO string, or null when empty. */
function dateToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function NewContentPage() {
  const t = useTranslations('pages.contentNew');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const router = useRouter();
  const { toast } = useToast();

  const modeLabels: Record<Mode, string> = {
    upload: t('modeUpload'),
    url: t('modeUrl'),
    text: t('modeText'),
  };

  const [mode, setMode] = useState<Mode>('upload');

  // Shared fields across all modes.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [orientation, setOrientation] = useState<Orientation>('UNKNOWN');
  const [expiresAt, setExpiresAt] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('');
  const [selectedTags, setSelectedTags] = useState<SelectorEntity[]>([]);
  const tagIds = selectedTags.map((tag) => tag.id);

  // Upload-specific.
  const [file, setFile] = useState<File | null>(null);
  // URL-specific.
  const [url, setUrl] = useState('');
  // Text-specific.
  const [textBody, setTextBody] = useState('');

  const [busy, setBusy] = useState(false);

  const parsedDuration = (): number | null => {
    const trimmed = durationSeconds.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    // Default the title to the file name (sans extension) when empty.
    if (selected && !title.trim()) {
      setTitle(selected.name.replace(/\.[^./\\]+$/, ''));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast(t('toastTitleRequired'), 'error');
      return;
    }

    const iso = dateToIso(expiresAt);
    const duration = parsedDuration();

    setBusy(true);
    try {
      let created: Content;

      if (mode === 'upload') {
        if (!file) {
          toast(t('toastChooseFile'), 'error');
          setBusy(false);
          return;
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', trimmedTitle);
        if (description.trim()) formData.append('description', description.trim());
        if (orientation) formData.append('orientation', orientation);
        if (iso) formData.append('expiresAt', iso);
        if (duration !== null) formData.append('durationSeconds', String(duration));
        if (tagIds.length > 0) formData.append('tags', tagIds.join(','));
        created = await api.upload<Content>('/content/upload', formData);
      } else if (mode === 'url') {
        const trimmedUrl = url.trim();
        if (!trimmedUrl) {
          toast(t('toastUrlRequired'), 'error');
          setBusy(false);
          return;
        }
        if (!isHttpUrl(trimmedUrl)) {
          toast(t('toastUrlInvalid'), 'error');
          setBusy(false);
          return;
        }
        created = await api.post<Content>('/content/url', {
          title: trimmedTitle,
          description: description.trim() || undefined,
          url: trimmedUrl,
          orientation,
          expiresAt: iso ?? undefined,
          durationSeconds: duration ?? undefined,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
        });
      } else {
        const trimmedBody = textBody.trim();
        if (!trimmedBody) {
          toast(t('toastTextRequired'), 'error');
          setBusy(false);
          return;
        }
        created = await api.post<Content>('/content/text', {
          title: trimmedTitle,
          description: description.trim() || undefined,
          textBody: trimmedBody,
          orientation,
          expiresAt: iso ?? undefined,
          durationSeconds: duration ?? undefined,
          tagIds: tagIds.length > 0 ? tagIds : undefined,
        });
      }

      toast(t('toastCreated'), 'success');
      router.push(`/company/content/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/company/content"
            className="border-border hover:bg-muted focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-transparent px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2"
          >
            <ArrowLeft className="size-4" />
            {t('backToContent')}
          </Link>
        }
      />

      {/* Segmented control */}
      <div className="border-border bg-muted/40 mb-6 inline-flex rounded-lg border p-1">
        {MODES.map(({ value, icon: Icon }) => {
          const active = mode === value;
          const label = modeLabels[value];
          return (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={active}
              disabled={busy}
              className={
                'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ' +
                (active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <Card>
          <CardContent className="space-y-5">
            {/* Mode-specific primary inputs */}
            {mode === 'upload' && (
              <Field label={t('fileLabel')} hint={t('fileHint')}>
                <Input
                  type="file"
                  accept={FILE_ACCEPT}
                  onChange={handleFileChange}
                  disabled={busy}
                  className="file:bg-muted h-auto py-2 file:me-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-medium"
                  aria-label={t('fileAriaLabel')}
                />
              </Field>
            )}

            {mode === 'url' && (
              <Field label={t('urlLabel')} hint={t('urlHint')}>
                <Input
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={t('urlPlaceholder')}
                  disabled={busy}
                  required
                />
              </Field>
            )}

            {mode === 'text' && (
              <Field label={t('textLabel')} hint={t('textHint')}>
                <Textarea
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                  placeholder={t('textPlaceholder')}
                  rows={5}
                  disabled={busy}
                  required
                />
              </Field>
            )}

            <Field label={t('titleLabel')}>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                required
                disabled={busy}
              />
            </Field>

            <Field label={tc('description')}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                rows={2}
                disabled={busy}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tc('orientation')}>
                <Select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as Orientation)}
                  disabled={busy}
                >
                  {ORIENTATION_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {te(`orientation.${o}`)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('expiresLabel')} hint={t('expiresHint')}>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  disabled={busy}
                />
              </Field>
            </div>

            <Field label={t('durationLabel')} hint={t('durationHint')}>
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                placeholder={t('durationPlaceholder')}
                disabled={busy}
                className="sm:max-w-[12rem]"
              />
            </Field>

            <div>
              <Label>{tc('tags')}</Label>
              <ServerSearchMultiSelect
                type="TAG"
                tagApplicability="CONTENT"
                value={selectedTags}
                onChange={setSelectedTags}
                searchPlaceholder={tc('search')}
                emptyText={t('tagsEmpty')}
                disabled={busy}
              />
              <p className="text-muted-foreground mt-1.5 text-xs">{t('tagsHint')}</p>
            </div>

            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Link
                href="/company/content"
                className="border-border hover:bg-muted focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-transparent px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2"
                aria-disabled={busy}
              >
                {tc('cancel')}
              </Link>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner className="size-4" />}
                {mode === 'upload' ? t('submitUpload') : t('submitCreate')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
