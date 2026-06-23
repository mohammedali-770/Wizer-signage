'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { Playlist, PlaylistItem } from '@/lib/types';
import { formatDuration } from '@/lib/format';
import { ContentPreview } from '@/components/content/content-preview';
import {
  ContentPickerDialog,
  type PickedContent,
} from '@/components/playlists/content-picker-dialog';
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

export default function PlaylistDetailPage() {
  const t = useTranslations('pages.playlistEditor');
  const tc = useTranslations('common');
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const { toast } = useToast();
  const {
    data: playlist,
    loading,
    error,
    reload,
  } = useApiResource<Playlist>(id ? `/playlists/${id}` : null);

  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<PlaylistItem | null>(null);
  const [editItem, setEditItem] = useState<PlaylistItem | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok?: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
      reload();
      after?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('actionFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }
  if (error || !playlist) {
    return <EmptyState title={t('notFound')} description={error ?? undefined} />;
  }

  const editable = playlist.status !== 'ARCHIVED';

  const addContent = (content: PickedContent) =>
    run(
      () =>
        api.post(`/playlists/${id}/items`, {
          contentId: content.id,
          // Videos need a duration or full-play; default to full-length playback.
          ...(content.type === 'VIDEO' ? { playFullVideo: true } : {}),
        }),
      t('addedToast'),
    );

  const move = (index: number, dir: -1 | 1) => {
    const items = [...playlist.items];
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    return run(() =>
      api.patch(`/playlists/${id}/items/reorder`, { itemIds: items.map((i) => i.id) }),
    );
  };

  return (
    <div>
      <Link
        href="/company/playlists"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {t('backToPlaylists')}
      </Link>

      <PageHeader
        title={playlist.title}
        description={playlist.description ?? undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMetaOpen(true)} disabled={busy}>
              <Pencil className="size-4" /> {tc('edit')}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                run(() =>
                  api
                    .post<Playlist>(`/playlists/${id}/duplicate`, {})
                    .then((p) => router.push(`/company/playlists/${p.id}`)),
                )
              }
              disabled={busy}
            >
              <Copy className="size-4" /> {t('duplicate')}
            </Button>
            {playlist.status === 'ARCHIVED' ? (
              <Button
                variant="outline"
                onClick={() =>
                  run(() => api.post(`/playlists/${id}/unarchive`), t('unarchivedToast'))
                }
                disabled={busy}
              >
                {t('unarchive')}
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => run(() => api.post(`/playlists/${id}/archive`), t('archivedToast'))}
                disabled={busy}
              >
                {t('archive')}
              </Button>
            )}
            <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <SummaryStat
          label={tc('status')}
          value={
            <Badge
              tone={
                playlist.status === 'ACTIVE'
                  ? 'success'
                  : playlist.status === 'DRAFT'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {playlist.status}
            </Badge>
          }
        />
        <SummaryStat
          label={tc('items')}
          value={t('validOfCount', {
            valid: playlist.validItemCount,
            total: playlist.itemCount,
          })}
        />
        <SummaryStat
          label={t('totalDuration')}
          value={formatDuration(playlist.totalDurationSeconds, locale)}
        />
        <SummaryStat
          label={tc('orientation')}
          value={<Badge tone="info">{playlist.orientationProfile}</Badge>}
        />
      </div>

      {playlist.warnings.length > 0 ? (
        <div className="mb-4 space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          {playlist.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-700 dark:text-amber-300">
              ⚠ {w}
            </p>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('playbackOrder')}</CardTitle>
          {editable ? (
            <Button size="sm" onClick={() => setPickerOpen(true)} disabled={busy}>
              <Plus className="size-4" /> {t('addContent')}
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">{t('unarchiveToEdit')}</span>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {playlist.items.length === 0 ? (
            <div className="p-6">
              <EmptyState title={t('noItems')} description={t('noItemsDescription')} />
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {playlist.items.map((item, index) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="text-muted-foreground w-6 text-center text-sm">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.content.title}</span>
                      <Badge tone="neutral">{item.content.type}</Badge>
                      <Badge tone="info">{item.content.orientation}</Badge>
                      {!item.valid ? (
                        <Badge tone="danger">{item.issue ?? t('invalid')}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {item.content.type === 'VIDEO' && item.playFullVideo
                        ? t('fullVideo')
                        : `${formatDuration(item.effectiveDurationSeconds, locale)}`}
                      {item.content.type === 'PDF' && item.pdfPageDurationSeconds
                        ? ` · ${t('perPage', { seconds: item.pdfPageDurationSeconds })}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreviewItem(item)}
                      aria-label={t('preview')}
                    >
                      <Eye className="size-4" />
                    </Button>
                    {editable ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditItem(item)}
                          disabled={busy}
                          aria-label={t('editItem')}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => move(index, -1)}
                          disabled={busy || index === 0}
                          aria-label={t('moveUp')}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => move(index, 1)}
                          disabled={busy || index === playlist.items.length - 1}
                          aria-label={t('moveDown')}
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            run(
                              () => api.del(`/playlists/${id}/items/${item.id}`),
                              t('removedToast'),
                            )
                          }
                          disabled={busy}
                          aria-label={t('remove')}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ContentPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addContent}
        busy={busy}
      />

      {previewItem ? (
        <Dialog
          open
          onClose={() => setPreviewItem(null)}
          title={previewItem.content.title}
          className="max-w-2xl"
        >
          <ContentPreview contentId={previewItem.contentId} type={previewItem.content.type} />
        </Dialog>
      ) : null}

      {editItem ? (
        <ItemEditDialog
          item={editItem}
          busy={busy}
          onClose={() => setEditItem(null)}
          onSave={(body) =>
            run(
              () => api.patch(`/playlists/${id}/items/${editItem.id}`, body),
              t('itemUpdatedToast'),
              () => setEditItem(null),
            )
          }
        />
      ) : null}

      {metaOpen ? (
        <MetaEditDialog
          playlist={playlist}
          busy={busy}
          onClose={() => setMetaOpen(false)}
          onSave={(body) =>
            run(
              () => api.patch(`/playlists/${id}`, body),
              t('playlistUpdatedToast'),
              () => setMetaOpen(false),
            )
          }
        />
      ) : null}

      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('deleteDialogTitle')}
        description={t('deleteDialogDescription')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              run(
                () => api.del(`/playlists/${id}`),
                t('deletedToast'),
                () => router.push('/company/playlists'),
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

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </Card>
  );
}

function ItemEditDialog({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: PlaylistItem;
  busy?: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('pages.playlistEditor');
  const tc = useTranslations('common');
  const isVideo = item.content.type === 'VIDEO';
  const isPdf = item.content.type === 'PDF';
  const [duration, setDuration] = useState(
    item.durationSeconds != null ? String(item.durationSeconds) : '',
  );
  const [playFull, setPlayFull] = useState(item.playFullVideo);
  const [pageDuration, setPageDuration] = useState(
    item.pdfPageDurationSeconds != null ? String(item.pdfPageDurationSeconds) : '',
  );

  const save = () => {
    const body: Record<string, unknown> = {};
    if (isVideo) body.playFullVideo = playFull;
    if (!(isVideo && playFull)) {
      const n = Number(duration);
      body.durationSeconds =
        duration.trim() === '' ? null : Number.isInteger(n) && n >= 1 ? n : null;
    }
    if (isPdf) {
      const p = Number(pageDuration);
      body.pdfPageDurationSeconds =
        pageDuration.trim() === '' ? null : Number.isInteger(p) && p >= 1 ? p : null;
    }
    onSave(body);
  };

  return (
    <Dialog open onClose={onClose} title={t('editItemTitle', { title: item.content.title })}>
      <div className="space-y-4">
        {isVideo ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={playFull}
              onChange={(e) => setPlayFull(e.target.checked)}
            />
            {t('playFullVideoLength')}
          </label>
        ) : null}
        {!(isVideo && playFull) ? (
          <Field label={t('durationSecondsLabel')} hint={t('durationHint')}>
            <Input
              type="number"
              min={1}
              step={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder={t('durationPlaceholder')}
            />
          </Field>
        ) : null}
        {isPdf ? (
          <Field label={t('perPageDurationLabel')} hint={t('perPageDurationHint')}>
            <Input
              type="number"
              min={1}
              step={1}
              value={pageDuration}
              onChange={(e) => setPageDuration(e.target.value)}
              placeholder="—"
            />
          </Field>
        ) : null}
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

function MetaEditDialog({
  playlist,
  busy,
  onClose,
  onSave,
}: {
  playlist: Playlist;
  busy?: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const t = useTranslations('pages.playlistEditor');
  const tc = useTranslations('common');
  const [title, setTitle] = useState(playlist.title);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [status, setStatus] = useState(playlist.status === 'ARCHIVED' ? 'ACTIVE' : playlist.status);

  return (
    <Dialog open onClose={onClose} title={t('editPlaylistTitle')}>
      <div className="space-y-4">
        <Field label={t('titleLabel')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label={tc('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={1000}
          />
        </Field>
        <Field label={tc('status')}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DRAFT')}>
            <option value="ACTIVE">{t('statusActive')}</option>
            <option value="DRAFT">{t('statusDraft')}</option>
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button
            onClick={() =>
              onSave({ title: title.trim(), description: description.trim() || null, status })
            }
            disabled={busy}
          >
            {tc('save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
