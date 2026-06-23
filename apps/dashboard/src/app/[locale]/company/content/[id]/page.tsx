'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import type { Content, ContentType, Orientation, Paginated, Tag } from '@/lib/types';
import { Link } from '@/i18n/navigation';
import { ContentPreview } from '@/components/content/content-preview';
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
  Label,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui';

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const FILE_TYPES: ContentType[] = ['IMAGE', 'VIDEO', 'PDF'];

/** A date value to a `yyyy-MM-dd` string for <input type="date">. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface EditForm {
  title: string;
  description: string;
  orientation: Orientation;
  expiresAt: string; // yyyy-MM-dd or ''
  durationSeconds: string;
  url: string;
  textBody: string;
  tagIds: string[];
}

function formFromContent(c: Content): EditForm {
  return {
    title: c.title,
    description: c.description ?? '',
    orientation: c.orientation,
    expiresAt: toDateInput(c.expiresAt),
    durationSeconds: c.durationSeconds != null ? String(c.durationSeconds) : '',
    url: c.url ?? '',
    textBody: c.textBody ?? '',
    tagIds: c.tags.map((t) => t.id),
  };
}

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const { toast } = useToast();
  const t = useTranslations('pages.contentDetail');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

  const {
    data: content,
    loading,
    error,
    reload,
  } = useApiResource<Content>(id ? `/content/${id}` : null);
  const tagsRes = useApiResource<Paginated<Tag>>('/tags?pageSize=100');
  const contentTags = useMemo(
    () => (tagsRes.data?.items ?? []).filter((t) => t.type === 'CONTENT' || t.type === 'BOTH'),
    [tagsRes.data],
  );

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Replace file
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacing, setReplacing] = useState(false);

  // Lifecycle
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // Keep the edit form fresh whenever the dialog opens against current content.
  useEffect(() => {
    if (editOpen && content) setForm(formFromContent(content));
  }, [editOpen, content]);

  const openEdit = () => {
    if (content) setForm(formFromContent(content));
    setEditOpen(true);
  };
  const closeEdit = () => {
    if (!saving) setEditOpen(false);
  };

  const toggleTag = (tagId: string) => {
    setForm((f) =>
      f
        ? {
            ...f,
            tagIds: f.tagIds.includes(tagId)
              ? f.tagIds.filter((t) => t !== tagId)
              : [...f.tagIds, tagId],
          }
        : f,
    );
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !form) return;
    if (!form.title.trim()) {
      toast(t('toast.titleRequired'), 'error');
      return;
    }
    if (content.type === 'URL' && !form.url.trim()) {
      toast(t('toast.urlRequired'), 'error');
      return;
    }
    if (content.type === 'TEXT' && !form.textBody.trim()) {
      toast(t('toast.textBodyRequired'), 'error');
      return;
    }

    const durationRaw = form.durationSeconds.trim();
    const duration = durationRaw === '' ? null : Number(durationRaw);
    if (duration !== null && (!Number.isInteger(duration) || duration < 1)) {
      toast(t('toast.durationInvalid'), 'error');
      return;
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      orientation: form.orientation,
      // null clears expiry; ISO string sets it (end of the chosen day).
      expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
      durationSeconds: duration,
      tagIds: form.tagIds,
    };
    if (content.type === 'URL') payload.url = form.url.trim();
    if (content.type === 'TEXT') payload.textBody = form.textBody;

    setSaving(true);
    try {
      await api.patch<Content>(`/content/${content.id}`, payload);
      toast(t('toast.updated'), 'success');
      setEditOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file again re-triggers change.
    e.target.value = '';
    if (!file || !content) return;

    const fd = new FormData();
    fd.append('file', file);
    setReplacing(true);
    try {
      await api.upload<Content>(`/content/${content.id}/replace`, fd);
      toast(t('toast.fileReplaced'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.error'), 'error');
    } finally {
      setReplacing(false);
    }
  };

  const runLifecycle = async (action: string, message: string) => {
    if (!content) return;
    setLifecycleBusy(true);
    try {
      await api.post(`/content/${content.id}/${action}`);
      toast(message, 'success');
      setTrashOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.error'), 'error');
    } finally {
      setLifecycleBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/company/content"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
        >
          <ArrowLeft className="size-4" />
          {t('backToLibrary')}
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && !content && (
        <EmptyState title={t('notFound')} description={t('notFoundDescription')} />
      )}

      {!loading && !error && content && (
        <>
          <PageHeader
            title={content.title}
            description={content.description ?? undefined}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={openEdit}>
                  <Pencil className="size-4" />
                  {tc('edit')}
                </Button>

                {FILE_TYPES.includes(content.type) && (
                  <>
                    <input
                      ref={replaceInputRef}
                      type="file"
                      className="hidden"
                      onChange={onReplaceFile}
                      aria-label={t('replaceFile')}
                    />
                    <Button
                      variant="outline"
                      onClick={() => replaceInputRef.current?.click()}
                      disabled={replacing}
                    >
                      {replacing ? <Spinner className="size-4" /> : <Upload className="size-4" />}
                      {t('replaceFile')}
                    </Button>
                  </>
                )}

                {content.status === 'ACTIVE' && (
                  <Button
                    variant="outline"
                    onClick={() => runLifecycle('archive', t('toast.archived'))}
                    disabled={lifecycleBusy}
                  >
                    <Archive className="size-4" />
                    {t('archive')}
                  </Button>
                )}
                {content.status === 'ARCHIVED' && (
                  <Button
                    variant="outline"
                    onClick={() => runLifecycle('unarchive', t('toast.unarchived'))}
                    disabled={lifecycleBusy}
                  >
                    <ArchiveRestore className="size-4" />
                    {t('unarchive')}
                  </Button>
                )}
                {content.status === 'TRASH' ? (
                  <Button
                    variant="outline"
                    onClick={() => runLifecycle('restore', t('toast.restored'))}
                    disabled={lifecycleBusy}
                  >
                    <RotateCcw className="size-4" />
                    {t('restore')}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => setTrashOpen(true)}
                    disabled={lifecycleBusy}
                  >
                    <Trash2 className="size-4" />
                    {t('trash')}
                  </Button>
                )}
              </div>
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-2">
            <StatusBadge status={content.status} />
            <Badge tone="info">{te(`contentType.${content.type}`)}</Badge>
            <Badge tone="neutral">{te(`orientation.${content.orientation}`)}</Badge>
            {content.isExpired && <Badge tone="danger">{t('expired')}</Badge>}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Preview */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t('preview')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ContentPreview contentId={content.id} type={content.type} />
                </CardContent>
              </Card>
            </div>

            {/* Metadata */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('details')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <MetaRow label={tc('description')} value={content.description || '—'} />
                  <MetaRow label={tc('type')} value={te(`contentType.${content.type}`)} />
                  <MetaRow
                    label={tc('orientation')}
                    value={te(`orientation.${content.orientation}`)}
                  />
                  {FILE_TYPES.includes(content.type) && (
                    <MetaRow
                      label={t('size')}
                      value={content.fileSize ? formatBytes(Number(content.fileSize), locale) : '—'}
                    />
                  )}
                  {content.originalFileName && (
                    <MetaRow label={t('originalFile')} value={content.originalFileName} />
                  )}
                  {content.mimeType && <MetaRow label={t('mimeType')} value={content.mimeType} />}
                  {content.pageCount != null && (
                    <MetaRow label={t('pages')} value={String(content.pageCount)} />
                  )}
                  {content.type === 'URL' && content.url && (
                    <MetaRow
                      label={t('url')}
                      value={
                        <a
                          href={content.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary break-all hover:underline"
                        >
                          {content.url}
                        </a>
                      }
                    />
                  )}
                  <MetaRow
                    label={t('duration')}
                    value={
                      content.durationSeconds != null
                        ? t('durationSeconds', { value: content.durationSeconds })
                        : t('default')
                    }
                  />
                  <MetaRow
                    label={t('expiry')}
                    value={
                      content.expiresAt ? (
                        <span
                          className={
                            content.isExpired ? 'font-medium text-red-600 dark:text-red-400' : ''
                          }
                        >
                          {formatDate(content.expiresAt, locale)}
                          {content.isExpired ? ` ${t('expiredSuffix')}` : ''}
                        </span>
                      ) : (
                        t('never')
                      )
                    }
                  />
                  <MetaRow
                    label={tc('created')}
                    value={formatDateTime(content.createdAt, locale)}
                  />
                  <MetaRow
                    label={tc('updated')}
                    value={formatDateTime(content.updatedAt, locale)}
                  />
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-muted-foreground text-xs font-medium uppercase">
                      {tc('tags')}
                    </span>
                    {content.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {content.tags.map((tag) => (
                          <Badge key={tag.id} tone="info">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t('noTags')}</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Edit dialog */}
          <Dialog
            open={editOpen}
            onClose={closeEdit}
            title={t('editTitle')}
            description={t('editDescription')}
          >
            {form && (
              <form onSubmit={submitEdit} className="max-h-[70vh] space-y-4 overflow-y-auto pe-1">
                <Field label={t('titleLabel')}>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((f) => (f ? { ...f, title: e.target.value } : f))}
                    required
                    autoFocus
                  />
                </Field>

                <Field label={tc('description')}>
                  <Textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, description: e.target.value } : f))
                    }
                    rows={2}
                  />
                </Field>

                {content.type === 'URL' && (
                  <Field label={t('url')}>
                    <Input
                      type="url"
                      value={form.url}
                      onChange={(e) => setForm((f) => (f ? { ...f, url: e.target.value } : f))}
                      placeholder="https://example.com"
                      required
                    />
                  </Field>
                )}

                {content.type === 'TEXT' && (
                  <Field label={t('textBody')}>
                    <Textarea
                      value={form.textBody}
                      onChange={(e) => setForm((f) => (f ? { ...f, textBody: e.target.value } : f))}
                      rows={4}
                      required
                    />
                  </Field>
                )}

                <Field label={tc('orientation')}>
                  <Select
                    value={form.orientation}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, orientation: e.target.value as Orientation } : f))
                    }
                  >
                    {ORIENTATION_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {te(`orientation.${o}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div>
                  <Label>{t('expiryDate')}</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={form.expiresAt}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, expiresAt: e.target.value } : f))
                      }
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm((f) => (f ? { ...f, expiresAt: '' } : f))}
                      disabled={!form.expiresAt}
                    >
                      {t('clearExpiry')}
                    </Button>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">{t('expiryHint')}</p>
                </div>

                <Field label={t('durationLabel')} hint={t('durationHint')}>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={form.durationSeconds}
                    onChange={(e) =>
                      setForm((f) => (f ? { ...f, durationSeconds: e.target.value } : f))
                    }
                    placeholder={t('default')}
                  />
                </Field>

                <div>
                  <Label>{tc('tags')}</Label>
                  {contentTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {contentTags.map((tag) => {
                        const selected = form.tagIds.includes(tag.id);
                        return (
                          <button
                            type="button"
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            aria-pressed={selected}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                              selected
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            <span
                              aria-hidden
                              className="border-border inline-block size-2.5 shrink-0 rounded-full border"
                              style={{ backgroundColor: tag.color ?? 'transparent' }}
                            />
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">{t('noContentTags')}</p>
                  )}
                </div>

                <div className="border-border flex justify-end gap-2 border-t pt-4">
                  <Button type="button" variant="outline" onClick={closeEdit} disabled={saving}>
                    {tc('cancel')}
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving && <Spinner className="size-4" />}
                    {t('saveChanges')}
                  </Button>
                </div>
              </form>
            )}
          </Dialog>

          {/* Trash confirmation */}
          <Dialog
            open={trashOpen}
            onClose={() => {
              if (!lifecycleBusy) setTrashOpen(false);
            }}
            title={t('trashTitle')}
            description={t('trashConfirm', { title: content.title })}
          >
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTrashOpen(false)}
                disabled={lifecycleBusy}
              >
                {tc('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => runLifecycle('trash', t('toast.movedToTrash'))}
                disabled={lifecycleBusy}
              >
                {lifecycleBusy && <Spinner className="size-4" />}
                {t('trashTitle')}
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium uppercase">{label}</span>
      <span className="text-foreground break-words">{value}</span>
    </div>
  );
}
