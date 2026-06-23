'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Search, Tags, Trash2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import type { Paginated, Tag, TagType } from '@/lib/types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  useToast,
} from '@/components/ui';

const PAGE_SIZE = 20;

const TAG_TYPES: TagType[] = ['SCREEN', 'CONTENT', 'BOTH'];

const TYPE_TONES: Record<TagType, 'info' | 'success' | 'neutral'> = {
  SCREEN: 'info',
  CONTENT: 'success',
  BOTH: 'neutral',
};

const DEFAULT_COLOR = '#6366f1';

interface FormState {
  name: string;
  type: TagType;
  color: string;
  colorEnabled: boolean;
  description: string;
}

function blankForm(): FormState {
  return {
    name: '',
    type: 'SCREEN',
    color: DEFAULT_COLOR,
    colorEnabled: false,
    description: '',
  };
}

function formFromTag(tag: Tag): FormState {
  return {
    name: tag.name,
    type: tag.type,
    color: tag.color ?? DEFAULT_COLOR,
    colorEnabled: !!tag.color,
    description: tag.description ?? '',
  };
}

export default function TagsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.tags');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();

  // Applied (committed) query state.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'' | TagType>('');

  // Pending search input (committed on Enter / button click).
  const [searchInput, setSearchInput] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState(false);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    return `/tags?${params.toString()}`;
  }, [page, search, type]);

  const { data, loading, error, reload } = useApiResource<Paginated<Tag>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const onTypeChange = (value: string) => {
    setType(value as '' | TagType);
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setDialogOpen(true);
  };

  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setForm(formFromTag(tag));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast(t('toasts.nameRequired'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        color: form.colorEnabled ? form.color : null,
        description: form.description.trim() || null,
      };

      if (editing) {
        await api.patch<Tag>(`/tags/${editing.id}`, payload);
        toast(t('toasts.updated'), 'success');
      } else {
        await api.post<Tag>('/tags', payload);
        toast(t('toasts.created'), 'success');
      }
      setDialogOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/tags/${deleteTarget.id}`);
      toast(t('toasts.deleted'), 'success');
      setDeleteTarget(null);
      // If we just removed the last item on a page beyond the first, step back.
      if (items.length === 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        reload();
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t('new')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
              aria-label={t('searchPlaceholder')}
            />
          </div>
          <Button type="submit" variant="outline">
            {tc('search')}
          </Button>
        </form>

        <Select
          value={type}
          onChange={(e) => onTypeChange(e.target.value)}
          className="w-44"
          aria-label={t('filterByType')}
        >
          <option value="">{t('allTypes')}</option>
          {TAG_TYPES.map((tt) => (
            <option key={tt} value={tt}>
              {te(`tagType.${tt}`)}
            </option>
          ))}
        </Select>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

      {!loading &&
        !error &&
        items.length === 0 &&
        (search || type ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyFiltered')} />
        ) : (
          <EmptyState
            icon={<Tags aria-hidden />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                {t('new')}
              </Button>
            }
          />
        ))}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{tc('type')}</TH>
                <TH>{t('columnDescription')}</TH>
                <TH className="text-end">{t('columnScreens')}</TH>
                <TH className="text-end">{tc('actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((tag) => (
                <TR key={tag.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="border-border inline-block size-3 shrink-0 rounded-full border"
                        style={{ backgroundColor: tag.color ?? 'transparent' }}
                      />
                      <span className="text-foreground font-medium">{tag.name}</span>
                    </div>
                  </TD>
                  <TD>
                    <Badge tone={TYPE_TONES[tag.type]}>{te(`tagType.${tag.type}`)}</Badge>
                  </TD>
                  <TD className="text-muted-foreground max-w-xs truncate">
                    {tag.description || '—'}
                  </TD>
                  <TD className="text-end tabular-nums">
                    {formatNumber(tag.screenCount ?? 0, locale)}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(tag)}>
                        <Pencil className="size-3.5" />
                        {tc('edit')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(tag)}>
                        <Trash2 className="size-3.5" />
                        {tc('delete')}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />}
        </>
      )}

      {/* Create / edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        description={editing ? t('dialog.editDescription') : t('dialog.createDescription')}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={tc('name')}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('form.namePlaceholder')}
              required
              autoFocus
            />
          </Field>

          <Field label={tc('type')} hint={t('form.typeHint')}>
            <Select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TagType }))}
            >
              {TAG_TYPES.map((tt) => (
                <option key={tt} value={tt}>
                  {te(`tagType.${tt}`)}
                </option>
              ))}
            </Select>
          </Field>

          <div>
            <Label>{t('form.colorLabel')}</Label>
            <div className="flex items-center gap-2">
              <input
                id="tag-color-enabled"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={form.colorEnabled}
                onChange={(e) => setForm((f) => ({ ...f, colorEnabled: e.target.checked }))}
              />
              <Label htmlFor="tag-color-enabled" className="mb-0">
                {t('form.useColor')}
              </Label>
              <input
                type="color"
                aria-label={t('form.colorLabel')}
                disabled={!form.colorEnabled}
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="border-border bg-background ms-2 h-9 w-14 cursor-pointer rounded-md border p-1 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {form.colorEnabled ? (
                <span className="text-muted-foreground text-xs">{form.color}</span>
              ) : null}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{t('form.colorHint')}</p>
          </div>

          <Field label={tc('description')}>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('form.descriptionPlaceholder')}
              rows={2}
            />
          </Field>

          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-4" />}
              {editing ? t('form.saveChanges') : t('form.createTag')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={t('deleteDialog.title')}
        description={
          deleteTarget ? t('deleteDialog.confirm', { name: deleteTarget.name }) : undefined
        }
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            {tc('cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={confirmDelete} disabled={deleting}>
            {deleting && <Spinner className="size-4" />}
            {tc('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
