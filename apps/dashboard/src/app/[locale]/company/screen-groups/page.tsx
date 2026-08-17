'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus, Search, Trash2, Users2 } from 'lucide-react';

import { api, apiFetch, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import type { Paginated, Screen, ScreenGroup, ScreenGroupDetail } from '@/lib/types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
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
const MEMBER_SEARCH_SIZE = 50;

interface GroupFormState {
  name: string;
  description: string;
  category: string;
}

function blankForm(): GroupFormState {
  return { name: '', description: '', category: '' };
}

function formFromGroup(group: ScreenGroup): GroupFormState {
  return {
    name: group.name,
    description: group.description ?? '',
    category: group.category ?? '',
  };
}

export default function ScreenGroupsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.screenGroups');
  const tc = useTranslations('common');
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Create / edit dialog.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScreenGroup | null>(null);
  const [form, setForm] = useState<GroupFormState>(blankForm);
  const [saving, setSaving] = useState(false);

  // Manage members dialog.
  const [manageGroup, setManageGroup] = useState<ScreenGroup | null>(null);

  // Delete confirmation dialog.
  const [deleting, setDeleting] = useState<ScreenGroup | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search) params.set('search', search);
    return `/screen-groups?${params.toString()}`;
  }, [page, search]);

  const { data, loading, error, reload } = useApiResource<Paginated<ScreenGroup>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setFormOpen(true);
  };

  const openEdit = (group: ScreenGroup) => {
    setEditing(group);
    setForm(formFromGroup(group));
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast(t('toastNameRequired'), 'error');
      return;
    }

    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
      };
      if (editing) {
        await api.patch<ScreenGroup>(`/screen-groups/${editing.id}`, body);
        toast(t('toastUpdated'), 'success');
      } else {
        await api.post<ScreenGroup>('/screen-groups', body);
        toast(t('toastCreated'), 'success');
      }
      setFormOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.del(`/screen-groups/${deleting.id}`);
      toast(t('toastDeleted'), 'success');
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setDeletingBusy(false);
    }
  };

  const groups = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t('newGroup')}
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
              aria-label={t('searchAriaLabel')}
            />
          </div>
          <Button type="submit" variant="outline">
            {tc('search')}
          </Button>
        </form>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadErrorTitle')} description={error} />}

      {!loading &&
        !error &&
        groups.length === 0 &&
        (search ? (
          <EmptyState title={t('emptyTitle')} description={t('emptySearchDescription')} />
        ) : (
          <EmptyState
            icon={<Users2 aria-hidden />}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            action={
              <Button onClick={openCreate}>
                <Plus className="size-4" />
                {t('newGroup')}
              </Button>
            }
          />
        ))}

      {!loading && !error && groups.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{t('columnCategory')}</TH>
                <TH>{t('columnDescription')}</TH>
                <TH className="text-end">{t('columnScreens')}</TH>
                <TH className="text-end">{tc('actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {groups.map((group) => (
                <TR key={group.id}>
                  <TD className="font-medium">{group.name}</TD>
                  <TD>
                    {group.category ? (
                      group.category
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-muted-foreground max-w-xs truncate">
                    {group.description ?? '—'}
                  </TD>
                  <TD className="text-end tabular-nums">
                    {formatNumber(group.screenCount ?? 0, locale)}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(group)}>
                        <Pencil className="size-3.5" />
                        {tc('edit')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setManageGroup(group)}>
                        <Users2 className="size-3.5" />
                        {t('manageScreens')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-500/10"
                        onClick={() => setDeleting(group)}
                      >
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

      {/* Create / Edit dialog */}
      <Dialog
        open={formOpen}
        onClose={closeForm}
        title={editing ? t('editTitle') : t('newTitle')}
        description={editing ? t('editDescription') : t('createDescription')}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label={tc('name')}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={t('namePlaceholder')}
              required
            />
          </Field>
          <Field label={t('columnCategory')} hint={t('categoryHint')}>
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder={t('categoryPlaceholder')}
            />
          </Field>
          <Field label={tc('description')}>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
            />
          </Field>

          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-4" />}
              {editing ? t('saveChanges') : t('createGroup')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Manage members dialog */}
      {manageGroup && (
        <ManageScreensDialog
          group={manageGroup}
          onClose={() => setManageGroup(null)}
          onChanged={reload}
        />
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!deleting}
        onClose={() => !deletingBusy && setDeleting(null)}
        title={t('deleteTitle')}
        description={deleting ? t('deleteConfirm', { name: deleting.name }) : undefined}
      >
        <div className="border-border flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleting(null)}
            disabled={deletingBusy}
          >
            {tc('cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={confirmDelete} disabled={deletingBusy}>
            {deletingBusy && <Spinner className="size-4" />}
            {t('deleteGroup')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * Manage group membership without a fleet-wide crawl. Searches are bounded to
 * one 50-row server page; selections accumulate across searches and keep their
 * labels locally until the operator submits them.
 */
function ManageScreensDialog({
  group,
  onClose,
  onChanged,
}: {
  group: ScreenGroup;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('pages.screenGroups');
  const tc = useTranslations('common');
  const { toast } = useToast();

  const detail = useApiResource<ScreenGroupDetail>(`/screen-groups/${group.id}`);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [candidateSearchInput, setCandidateSearchInput] = useState('');
  const candidatePath = useMemo(() => {
    const params = new URLSearchParams({ page: '1', pageSize: String(MEMBER_SEARCH_SIZE) });
    if (candidateSearch) params.set('search', candidateSearch);
    return `/screens?${params.toString()}`;
  }, [candidateSearch]);
  const candidatesResource = useApiResource<Paginated<Screen>>(candidatePath);

  const [selected, setSelected] = useState<Array<{ id: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const members = useMemo(() => detail.data?.screens ?? [], [detail.data]);
  const memberIds = useMemo(() => new Set(members.map((s) => s.id)), [members]);
  const selectedIds = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);

  const candidates = useMemo(
    () => (candidatesResource.data?.items ?? []).filter((screen) => !memberIds.has(screen.id)),
    [candidatesResource.data, memberIds],
  );

  const toggleSelect = (screen: Screen) =>
    setSelected((prev) =>
      prev.some((item) => item.id === screen.id)
        ? prev.filter((item) => item.id !== screen.id)
        : [...prev, { id: screen.id, name: screen.name }],
    );

  const handleAdd = async () => {
    const screenIds = selected.map((item) => item.id).filter((id) => !memberIds.has(id));
    if (screenIds.length === 0) return;
    setAdding(true);
    try {
      await api.post(`/screen-groups/${group.id}/screens`, { screenIds });
      toast(
        screenIds.length === 1
          ? t('toastScreenAdded')
          : t('toastScreensAdded', { count: screenIds.length }),
        'success',
      );
      setSelected([]);
      detail.reload();
      candidatesResource.reload();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (screenId: string) => {
    setRemovingId(screenId);
    try {
      await apiFetch(`/screen-groups/${group.id}/screens`, {
        method: 'DELETE',
        body: { screenIds: [screenId] },
      });
      toast(t('toastScreenRemoved'), 'success');
      detail.reload();
      candidatesResource.reload();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('manageTitle', { name: group.name })}
      description={t('manageDescription')}
      className="max-h-[90vh] max-w-2xl overflow-y-auto"
    >
      {detail.loading && (
        <div className="flex justify-center py-10">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!detail.loading && detail.error && (
        <EmptyState title={t('manageLoadError')} description={detail.error ?? undefined} />
      )}

      {!detail.loading && !detail.error && (
        <div className="space-y-6">
          {/* Current members */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              {t('members')}{' '}
              <span className="text-muted-foreground font-normal">({members.length})</span>
            </h3>
            {members.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                {t('noMembers')}
              </p>
            ) : (
              <ul className="divide-border border-border divide-y rounded-lg border">
                {members.map((screen) => (
                  <li key={screen.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{screen.name}</span>
                      <StatusBadge status={screen.status} />
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-500/10"
                      disabled={removingId === screen.id}
                      onClick={() => handleRemove(screen.id)}
                    >
                      {removingId === screen.id ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                      {t('remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add screens */}
          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t('addScreens')}</h3>
              <Button size="sm" onClick={handleAdd} disabled={adding || selected.length === 0}>
                {adding && <Spinner className="size-3.5" />}
                {selected.length > 0 ? t('addCount', { count: selected.length }) : t('add')}
              </Button>
            </div>

            {selected.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {selected.map((screen) => (
                  <button
                    key={screen.id}
                    type="button"
                    onClick={() =>
                      setSelected((prev) => prev.filter((item) => item.id !== screen.id))
                    }
                    className="focus-visible:ring-primary/40 rounded-full focus-visible:outline-none focus-visible:ring-2"
                    title={tc('remove')}
                  >
                    <Badge tone="info">{screen.name} ×</Badge>
                  </button>
                ))}
              </div>
            )}

            <form
              className="mb-3 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setCandidateSearch(candidateSearchInput.trim());
              }}
            >
              <div className="relative flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
                <Input
                  value={candidateSearchInput}
                  onChange={(event) => setCandidateSearchInput(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="ps-9"
                />
              </div>
              <Button type="submit" variant="outline">
                {tc('search')}
              </Button>
            </form>

            {candidatesResource.loading && candidates.length === 0 ? (
              <div className="flex justify-center py-6">
                <Spinner className="text-primary size-5" />
              </div>
            ) : candidatesResource.error ? (
              <EmptyState title={t('manageLoadError')} description={candidatesResource.error} />
            ) : candidates.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                {t('noCandidates')}
              </p>
            ) : (
              <ul className="divide-border border-border max-h-64 divide-y overflow-y-auto rounded-lg border">
                {candidates.map((screen) => {
                  const checked = selectedIds.has(screen.id);
                  return (
                    <li key={screen.id}>
                      <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 transition">
                        <input
                          type="checkbox"
                          className="border-border accent-primary size-4 rounded"
                          checked={checked}
                          onChange={() => toggleSelect(screen)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {screen.name}
                        </span>
                        {screen.location?.name ? (
                          <span className="text-muted-foreground truncate text-xs">
                            {screen.location.name}
                          </span>
                        ) : null}
                        <StatusBadge status={screen.status} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="border-border flex justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('done')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
