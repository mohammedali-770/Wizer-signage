'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Archive,
  ArchiveRestore,
  FileText,
  Film,
  Image as ImageIcon,
  Library,
  Link2,
  RotateCcw,
  Search,
  Tag as TagIcon,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useAllPages, useApiResource } from '@/lib/use-api';
import { formatBytes, formatDate, formatNumber } from '@/lib/format';
import type {
  Content,
  ContentStatus,
  ContentType,
  ContentUsage,
  Orientation,
  Paginated,
  Tag,
} from '@/lib/types';
import { Link } from '@/i18n/navigation';
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
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';
import { ContentPreview } from '@/components/content/content-preview';

const PAGE_SIZE = 20;

type StatusTab = Extract<ContentStatus, 'ACTIVE' | 'ARCHIVED' | 'TRASH'>;
type ExpiryFilter = '' | 'active' | 'expiring' | 'expired' | 'none';
type SortOption = 'newest' | 'oldest' | 'title' | 'size' | 'expiry';

const STATUS_TABS: StatusTab[] = ['ACTIVE', 'ARCHIVED', 'TRASH'];

const TYPE_OPTIONS: ContentType[] = ['IMAGE', 'VIDEO', 'PDF', 'URL', 'TEXT'];

const TYPE_TONES: Record<ContentType, 'info' | 'success' | 'warning' | 'neutral'> = {
  IMAGE: 'info',
  VIDEO: 'success',
  PDF: 'warning',
  URL: 'neutral',
  TEXT: 'neutral',
};

const TYPE_ICONS: Record<ContentType, typeof ImageIcon> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  PDF: FileText,
  URL: Link2,
  TEXT: Type,
};

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const EXPIRY_OPTIONS: ExpiryFilter[] = ['', 'active', 'expiring', 'expired', 'none'];

const SORT_OPTIONS: SortOption[] = ['newest', 'oldest', 'title', 'size', 'expiry'];

/** Window (ms) within which an unexpired item is considered "expiring soon". */
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

function isExpiringSoon(content: Content): boolean {
  if (content.isExpired || !content.expiresAt) return false;
  const diff = new Date(content.expiresAt).getTime() - Date.now();
  return diff > 0 && diff <= EXPIRING_SOON_MS;
}

type BulkActionKind = 'archive' | 'unarchive' | 'trash' | 'restore';

const BULK_ACTIONS: Record<BulkActionKind, { danger: boolean }> = {
  archive: { danger: false },
  unarchive: { danger: false },
  trash: { danger: true },
  restore: { danger: false },
};

export default function ContentLibraryPage() {
  const locale = useLocale();
  const t = useTranslations('pages.content');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();

  // Committed query state.
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusTab>('ACTIVE');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'' | ContentType>('');
  const [orientation, setOrientation] = useState<'' | Orientation>('');
  const [tagId, setTagId] = useState('');
  const [expiry, setExpiry] = useState<ExpiryFilter>('');
  const [sort, setSort] = useState<SortOption>('newest');

  // Pending search input (committed on Enter / button).
  const [searchInput, setSearchInput] = useState('');

  // Row selection (ids on the current page).
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal / dialog state.
  const [previewTarget, setPreviewTarget] = useState<Content | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkActionKind | null>(null);
  const [tagDialog, setTagDialog] = useState<null | { action: 'add' | 'remove'; tagId: string }>(
    null,
  );
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const usage = useApiResource<ContentUsage>('/content/usage');
  const tags = useAllPages<Tag>('/tags');

  const contentTags = useMemo(
    () => (tags.data?.items ?? []).filter((t) => t.type === 'CONTENT' || t.type === 'BOTH'),
    [tags.data],
  );

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    params.set('status', status);
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (orientation) params.set('orientation', orientation);
    if (tagId) params.set('tagId', tagId);
    if (expiry) params.set('expiry', expiry);
    params.set('sort', sort);
    return `/content?${params.toString()}`;
  }, [page, status, search, type, orientation, tagId, expiry, sort]);

  const { data, loading, error, reload } = useApiResource<Paginated<Content>>(path);

  const items = data?.items ?? [];
  const meta = data?.meta;
  const hasFilters = !!(search || type || orientation || tagId || expiry);

  const reloadAll = () => {
    reload();
    usage.reload();
  };

  const clearSelection = () => setSelected(new Set());

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
    clearSelection();
  };

  const changeTab = (next: StatusTab) => {
    if (next === status) return;
    setStatus(next);
    setPage(1);
    setExpiry('');
    clearSelection();
  };

  const resetPage = () => {
    setPage(1);
    clearSelection();
  };

  const onPage = (next: number) => {
    setPage(next);
    clearSelection();
  };

  // --- Selection helpers ---------------------------------------------------
  const pageIds = items.map((c) => c.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  // --- Single-row status actions ------------------------------------------
  const runRowAction = async (content: Content, action: BulkActionKind) => {
    setBusy(true);
    try {
      await api.post(`/content/${content.id}/${action}`);
      toast(t(`bulkSuccess.${action}`), 'success');
      reloadAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // --- Bulk status actions -------------------------------------------------
  const confirmBulkAction = async () => {
    if (!bulkAction || selectedIds.length === 0) return;
    setBusy(true);
    try {
      await api.post(`/content/bulk/${bulkAction}`, { contentIds: selectedIds });
      toast(
        `${t(`bulkSuccess.${bulkAction}`)} (${formatNumber(selectedIds.length, locale)})`,
        'success',
      );
      setBulkAction(null);
      clearSelection();
      reloadAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // --- Bulk tag add/remove -------------------------------------------------
  const confirmBulkTag = async () => {
    if (!tagDialog || selectedIds.length === 0) return;
    if (!tagDialog.tagId) {
      toast(t('toastSelectTag'), 'error');
      return;
    }
    setBusy(true);
    try {
      await api.post('/content/bulk/tags', {
        contentIds: selectedIds,
        tagId: tagDialog.tagId,
        action: tagDialog.action,
      });
      toast(tagDialog.action === 'add' ? t('toastTagAdded') : t('toastTagRemoved'), 'success');
      setTagDialog(null);
      clearSelection();
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  // --- Trash purge ---------------------------------------------------------
  const confirmPurge = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ purged: number }>('/content/trash/purge');
      toast(t('toastPurged', { count: formatNumber(res.purged, locale) }), 'success');
      setPurgeOpen(false);
      clearSelection();
      reloadAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
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
            href="/company/content/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Upload className="size-4" />
            {t('uploadNew')}
          </Link>
        }
      />

      <StorageUsageCard usage={usage.data} loading={usage.loading} locale={locale} />

      {/* Status tabs */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="border-border bg-muted/30 inline-flex rounded-lg border p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => changeTab(tab)}
              className={
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition ' +
                (status === tab
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground')
              }
              aria-pressed={status === tab}
            >
              {t(`tabs.${tab}`)}
              {usage.data ? (
                <span className="text-muted-foreground ms-1.5 text-xs">
                  {formatNumber(usage.data.counts.byStatus[tab] ?? 0, locale)}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {status === 'TRASH' ? (
          <Button variant="danger" onClick={() => setPurgeOpen(true)}>
            <Trash2 className="size-4" />
            {t('purgeOld')}
          </Button>
        ) : null}
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="ps-9"
              aria-label={t('searchAria')}
            />
          </div>
          <Button type="submit" variant="outline">
            {tc('search')}
          </Button>
        </form>

        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | ContentType);
            resetPage();
          }}
          className="w-36"
          aria-label={t('filterTypeAria')}
        >
          <option value="">{t('allTypes')}</option>
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {te(`contentType.${opt}`)}
            </option>
          ))}
        </Select>

        <Select
          value={orientation}
          onChange={(e) => {
            setOrientation(e.target.value as '' | Orientation);
            resetPage();
          }}
          className="w-40"
          aria-label={t('filterOrientationAria')}
        >
          <option value="">{t('allOrientations')}</option>
          {ORIENTATION_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {te(`orientation.${o}`)}
            </option>
          ))}
        </Select>

        <Select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            resetPage();
          }}
          className="w-40"
          aria-label={t('filterTagAria')}
        >
          <option value="">{t('allTags')}</option>
          {contentTags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>

        <Select
          value={expiry}
          onChange={(e) => {
            setExpiry(e.target.value as ExpiryFilter);
            resetPage();
          }}
          className="w-44"
          aria-label={t('filterExpiryAria')}
        >
          {EXPIRY_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {t(`expiry.${o || 'any'}`)}
            </option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as SortOption);
            resetPage();
          }}
          className="w-36"
          aria-label={t('sortAria')}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {t(`sort.${o}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Bulk actions toolbar */}
      {selectedIds.length > 0 && (
        <BulkToolbar
          count={selectedIds.length}
          status={status}
          locale={locale}
          onClear={clearSelection}
          onAction={(a) => setBulkAction(a)}
          onTag={(action) => setTagDialog({ action, tagId: '' })}
        />
      )}

      {/* List states. First load → skeleton; on refetch the rows stay visible. */}
      {loading && items.length === 0 && (
        <div className="mt-4">
          <TableSkeleton rows={8} columns={5} />
        </div>
      )}

      {error && items.length === 0 && <EmptyState title={t('errorTitle')} description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={t('emptyTitle')}
          description={
            hasFilters
              ? t('emptyFiltered')
              : status === 'ACTIVE'
                ? t('emptyActive')
                : status === 'ARCHIVED'
                  ? t('emptyArchived')
                  : t('emptyTrash')
          }
          icon={!hasFilters && status === 'ACTIVE' ? <Library aria-hidden /> : undefined}
          action={
            !hasFilters && status === 'ACTIVE' ? (
              <Link
                href="/company/content/new"
                className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
              >
                <Upload className="size-4" />
                {t('uploadNew')}
              </Link>
            ) : undefined
          }
        />
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <Table>
            <THead>
              <TR>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    className="border-border accent-primary size-4 cursor-pointer rounded"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && someSelected;
                    }}
                    onChange={toggleAll}
                    aria-label={t('selectAllAria')}
                  />
                </TH>
                <TH>{t('colTitle')}</TH>
                <TH>{tc('type')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{tc('orientation')}</TH>
                <TH>{tc('tags')}</TH>
                <TH>{t('colSize')}</TH>
                <TH>{t('colExpiry')}</TH>
                <TH>{tc('created')}</TH>
                <TH className="text-end">{tc('actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((content) => (
                <ContentRow
                  key={content.id}
                  content={content}
                  locale={locale}
                  selected={selected.has(content.id)}
                  busy={busy}
                  onToggle={() => toggleOne(content.id)}
                  onPreview={() => setPreviewTarget(content)}
                  onAction={(a) => runRowAction(content, a)}
                />
              ))}
            </TBody>
          </Table>

          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={onPage} />}
        </div>
      )}

      {/* Preview dialog */}
      <Dialog
        open={!!previewTarget}
        onClose={() => setPreviewTarget(null)}
        title={previewTarget?.title ?? t('preview')}
        description={previewTarget ? te(`contentType.${previewTarget.type}`) : undefined}
        className="max-w-3xl"
      >
        {previewTarget ? (
          <div className="space-y-4">
            <ContentPreview contentId={previewTarget.id} type={previewTarget.type} />
            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Link
                href={`/company/content/${previewTarget.id}`}
                className="border-border hover:bg-muted inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition"
              >
                {t('viewDetails')}
              </Link>
              <Button type="button" variant="outline" onClick={() => setPreviewTarget(null)}>
                {tc('close')}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      {/* Bulk action confirmation dialog */}
      <Dialog
        open={!!bulkAction}
        onClose={() => {
          if (!busy) setBulkAction(null);
        }}
        title={bulkAction ? te(`bulkAction.${bulkAction}`) : ''}
        description={
          bulkAction
            ? t('bulkConfirm', {
                action: te(`bulkAction.${bulkAction}`),
                count: formatNumber(selectedIds.length, locale),
              }) + (BULK_ACTIONS[bulkAction].danger ? ' ' + t('bulkConfirmRestorable') : '')
            : undefined
        }
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setBulkAction(null)}
            disabled={busy}
          >
            {tc('cancel')}
          </Button>
          <Button
            type="button"
            variant={bulkAction && BULK_ACTIONS[bulkAction].danger ? 'danger' : 'primary'}
            onClick={confirmBulkAction}
            disabled={busy}
          >
            {busy && <Spinner className="size-4" />}
            {bulkAction ? te(`bulkAction.${bulkAction}`) : ''}
          </Button>
        </div>
      </Dialog>

      {/* Bulk tag dialog */}
      <Dialog
        open={!!tagDialog}
        onClose={() => {
          if (!busy) setTagDialog(null);
        }}
        title={
          tagDialog?.action === 'remove' ? t('tagDialog.titleRemove') : t('tagDialog.titleAdd')
        }
        description={
          tagDialog
            ? tagDialog.action === 'remove'
              ? t('tagDialog.descriptionRemove', {
                  count: formatNumber(selectedIds.length, locale),
                })
              : t('tagDialog.descriptionAdd', { count: formatNumber(selectedIds.length, locale) })
            : undefined
        }
      >
        <div className="space-y-4">
          <Field label={t('tagDialog.contentTag')}>
            <Select
              value={tagDialog?.tagId ?? ''}
              onChange={(e) =>
                setTagDialog((prev) => (prev ? { ...prev, tagId: e.target.value } : prev))
              }
            >
              <option value="">{t('tagDialog.selectTag')}</option>
              {contentTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </Select>
          </Field>
          {contentTags.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('tagDialog.noTags')}</p>
          ) : null}
          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTagDialog(null)}
              disabled={busy}
            >
              {tc('cancel')}
            </Button>
            <Button type="button" onClick={confirmBulkTag} disabled={busy || !tagDialog?.tagId}>
              {busy && <Spinner className="size-4" />}
              {tagDialog?.action === 'remove' ? t('removeTag') : t('addTag')}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Purge trash dialog */}
      <Dialog
        open={purgeOpen}
        onClose={() => {
          if (!busy) setPurgeOpen(false);
        }}
        title={t('purgeDialog.title')}
        description={t('purgeDialog.description')}
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setPurgeOpen(false)}
            disabled={busy}
          >
            {tc('cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={confirmPurge} disabled={busy}>
            {busy && <Spinner className="size-4" />}
            {t('purgeDialog.confirm')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storage usage card
// ---------------------------------------------------------------------------

function StorageUsageCard({
  usage,
  loading,
  locale,
}: {
  usage: ContentUsage | null;
  loading: boolean;
  locale: string;
}) {
  const t = useTranslations('pages.content');
  const te = useTranslations('enums');

  if (loading && !usage) {
    return (
      <Card className="flex items-center justify-center py-10">
        <Spinner className="text-primary size-5" />
      </Card>
    );
  }
  if (!usage) return null;

  const { storage, counts } = usage;
  const percent = storage.percentUsed;
  const tone: 'success' | 'warning' | 'danger' =
    storage.status === 'blocked' || storage.status === 'exceeded'
      ? 'danger'
      : storage.status === 'grace' || storage.status === 'approaching'
        ? 'warning'
        : 'success';

  const limitLabel =
    storage.unlimited || storage.limitGb === null
      ? t('storage.unlimited')
      : formatBytes(storage.limitGb * 1000 * 1000 * 1000, locale);

  const barPercent = storage.unlimited || percent === null ? 0 : Math.min(percent, 100);

  return (
    <Card>
      {(storage.status === 'grace' || storage.status === 'blocked') && (
        <div
          className={
            'border-b px-5 py-3 text-sm ' +
            (storage.status === 'blocked'
              ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300')
          }
        >
          {storage.status === 'blocked'
            ? t('storage.blockedBanner')
            : storage.gracePeriodEndsAt
              ? t('storage.graceBannerEnding', {
                  date: formatDate(storage.gracePeriodEndsAt, locale),
                })
              : t('storage.graceBanner')}
        </div>
      )}

      <CardHeader className="flex items-center justify-between">
        <CardTitle>{t('storage.title')}</CardTitle>
        {!storage.unlimited && percent !== null ? (
          <Badge tone={tone}>
            {t('storage.percentUsed', {
              percent: formatNumber(percent, locale, { maximumFractionDigits: 0 }),
            })}
          </Badge>
        ) : (
          <Badge tone="info">{t('storage.unlimited')}</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="flex items-baseline justify-between">
            <p className="text-2xl font-semibold tracking-tight">
              {formatBytes(storage.usedBytes, locale)}
              <span className="text-muted-foreground ms-1.5 text-sm font-normal">
                {t('storage.ofLimit', { limit: limitLabel })}
              </span>
            </p>
          </div>
          {!storage.unlimited && percent !== null ? (
            <div className="bg-muted mt-3 h-2 w-full overflow-hidden rounded-full">
              <div
                className={
                  'h-full rounded-full transition-all ' +
                  (tone === 'danger'
                    ? 'bg-red-500'
                    : tone === 'warning'
                      ? 'bg-amber-500'
                      : 'bg-emerald-500')
                }
                style={{ width: `${barPercent}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((opt) => {
            const Icon = TYPE_ICONS[opt];
            return (
              <span
                key={opt}
                className="border-border bg-muted/30 text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
              >
                <Icon className="size-3.5" aria-hidden />
                {te(`contentType.${opt}`)}
                <span className="text-foreground font-medium">
                  {formatNumber(counts.byType[opt] ?? 0, locale)}
                </span>
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Bulk actions toolbar
// ---------------------------------------------------------------------------

function BulkToolbar({
  count,
  status,
  locale,
  onClear,
  onAction,
  onTag,
}: {
  count: number;
  status: StatusTab;
  locale: string;
  onClear: () => void;
  onAction: (action: BulkActionKind) => void;
  onTag: (action: 'add' | 'remove') => void;
}) {
  const t = useTranslations('pages.content');
  const te = useTranslations('enums');

  return (
    <div className="border-primary/30 bg-primary/5 mt-4 flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3">
      <span className="me-1 text-sm font-medium">
        {t('selected', { count: formatNumber(count, locale) })}
      </span>

      {status === 'ACTIVE' && (
        <Button size="sm" variant="outline" onClick={() => onAction('archive')}>
          <Archive className="size-3.5" />
          {te('bulkAction.archive')}
        </Button>
      )}
      {status === 'ARCHIVED' && (
        <Button size="sm" variant="outline" onClick={() => onAction('unarchive')}>
          <ArchiveRestore className="size-3.5" />
          {te('bulkAction.unarchive')}
        </Button>
      )}
      {(status === 'ACTIVE' || status === 'ARCHIVED') && (
        <Button size="sm" variant="outline" onClick={() => onAction('trash')}>
          <Trash2 className="size-3.5" />
          {te('bulkAction.trash')}
        </Button>
      )}
      {status === 'TRASH' && (
        <Button size="sm" variant="outline" onClick={() => onAction('restore')}>
          <RotateCcw className="size-3.5" />
          {te('bulkAction.restore')}
        </Button>
      )}

      {status !== 'TRASH' && (
        <>
          <span className="bg-border mx-1 h-5 w-px" aria-hidden />
          <Button size="sm" variant="outline" onClick={() => onTag('add')}>
            <TagIcon className="size-3.5" />
            {t('addTag')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => onTag('remove')}>
            <TagIcon className="size-3.5" />
            {t('removeTag')}
          </Button>
        </>
      )}

      <Button size="sm" variant="ghost" className="ms-auto" onClick={onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content row
// ---------------------------------------------------------------------------

function ContentRow({
  content,
  locale,
  selected,
  busy,
  onToggle,
  onPreview,
  onAction,
}: {
  content: Content;
  locale: string;
  selected: boolean;
  busy: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onAction: (action: BulkActionKind) => void;
}) {
  const t = useTranslations('pages.content');
  const te = useTranslations('enums');
  const Icon = TYPE_ICONS[content.type];
  const expiringSoon = isExpiringSoon(content);
  const sizeLabel =
    content.type === 'URL' || content.type === 'TEXT' || !content.fileSize
      ? '—'
      : formatBytes(Number(content.fileSize), locale);

  return (
    <TR className={selected ? 'bg-primary/5' : undefined}>
      <TD>
        <input
          type="checkbox"
          className="border-border accent-primary size-4 cursor-pointer rounded"
          checked={selected}
          onChange={onToggle}
          aria-label={t('selectRow', { title: content.title })}
        />
      </TD>

      <TD>
        <div className="flex items-center gap-2.5">
          <span className="border-border bg-muted/40 text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
            <Icon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <button
              type="button"
              onClick={onPreview}
              className="text-foreground hover:text-primary block max-w-[16rem] truncate text-start font-medium hover:underline"
              title={content.title}
            >
              {content.title}
            </button>
            <Link
              href={`/company/content/${content.id}`}
              className="text-muted-foreground hover:text-primary text-xs hover:underline"
            >
              {t('viewDetails')}
            </Link>
          </div>
        </div>
      </TD>

      <TD>
        <Badge tone={TYPE_TONES[content.type]}>{te(`contentType.${content.type}`)}</Badge>
      </TD>

      <TD>
        <StatusBadge status={content.status} />
      </TD>

      <TD className="text-muted-foreground">{te(`orientation.${content.orientation}`)}</TD>

      <TD>
        {content.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {content.tags.map((tag) => (
              <Badge key={tag.id} tone="info">
                {tag.name}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TD>

      <TD className="text-muted-foreground whitespace-nowrap tabular-nums">{sizeLabel}</TD>

      <TD className="whitespace-nowrap">
        {content.expiresAt ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">{formatDate(content.expiresAt, locale)}</span>
            {content.isExpired ? (
              <Badge tone="danger">{t('badge.expired')}</Badge>
            ) : expiringSoon ? (
              <Badge tone="warning">{t('badge.expiring')}</Badge>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TD>

      <TD className="text-muted-foreground whitespace-nowrap">
        {formatDate(content.createdAt, locale)}
      </TD>

      <TD>
        <div className="flex items-center justify-end gap-2">
          {content.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('archive')}>
              <Archive className="size-3.5" />
              {te('bulkAction.archive')}
            </Button>
          )}
          {content.status === 'ARCHIVED' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction('unarchive')}
            >
              <ArchiveRestore className="size-3.5" />
              {te('bulkAction.unarchive')}
            </Button>
          )}
          {content.status === 'TRASH' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('restore')}>
              <RotateCcw className="size-3.5" />
              {te('bulkAction.restore')}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction('trash')}>
              <Trash2 className="size-3.5" />
              {t('rowTrash')}
            </Button>
          )}
        </div>
      </TD>
    </TR>
  );
}
