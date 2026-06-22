'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Pencil, Plus, Search, Trash2, Users2 } from 'lucide-react';

import { api, apiFetch, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import type { Paginated, Screen, ScreenGroup, ScreenGroupDetail } from '@/lib/types';
import {
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
      toast('Name is required.', 'error');
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
        toast('Group updated.', 'success');
      } else {
        await api.post<ScreenGroup>('/screen-groups', body);
        toast('Group created.', 'success');
      }
      setFormOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await api.del(`/screen-groups/${deleting.id}`);
      toast('Group deleted.', 'success');
      setDeleting(null);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setDeletingBusy(false);
    }
  };

  const groups = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div>
      <PageHeader
        title="Screen Groups"
        description="Organise screens into groups for bulk targeting and management."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            New Group
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
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search groups…"
              className="pl-9"
              aria-label="Search groups"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load screen groups" description={error} />}

      {!loading && !error && groups.length === 0 && (
        <EmptyState
          title="No screen groups found"
          description={
            search
              ? 'Try adjusting your search.'
              : 'Create your first group to start organising screens.'
          }
        />
      )}

      {!loading && !error && groups.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Description</TH>
                <TH className="text-right">Screens</TH>
                <TH className="text-right">Actions</TH>
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
                  <TD className="text-right tabular-nums">
                    {formatNumber(group.screenCount ?? 0, locale)}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(group)}>
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setManageGroup(group)}>
                        <Users2 className="size-3.5" />
                        Manage screens
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:bg-red-500/10"
                        onClick={() => setDeleting(group)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
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
        title={editing ? 'Edit Group' : 'New Group'}
        description={
          editing
            ? 'Update this group’s name, category, and description.'
            : 'Create a group to organise related screens.'
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Lobby screens"
              required
            />
          </Field>
          <Field label="Category" hint="Optional grouping label, e.g. Indoor or Storefront.">
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Indoor"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this group is used for."
              rows={3}
            />
          </Field>

          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-4" />}
              {editing ? 'Save changes' : 'Create group'}
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
        title="Delete group"
        description={
          deleting
            ? `“${deleting.name}” will be permanently deleted. Screens in this group are not deleted, only removed from the group.`
            : undefined
        }
      >
        <div className="border-border flex justify-end gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => setDeleting(null)}
            disabled={deletingBusy}
          >
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={confirmDelete} disabled={deletingBusy}>
            {deletingBusy && <Spinner className="size-4" />}
            Delete group
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/**
 * Manage the screens belonging to a group: load current members, add screens
 * from a multi-select of all company screens, and remove existing members.
 * The detail is reloaded after each mutation so the member list stays in sync.
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
  const { toast } = useToast();

  const detail = useApiResource<ScreenGroupDetail>(`/screen-groups/${group.id}`);
  const allScreens = useApiResource<Paginated<Screen>>('/screens?pageSize=100');

  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const members = useMemo(() => detail.data?.screens ?? [], [detail.data]);
  const memberIds = useMemo(() => new Set(members.map((s) => s.id)), [members]);

  // Screens that are not already members are eligible to be added.
  const candidates = useMemo(
    () => (allScreens.data?.items ?? []).filter((s) => !memberIds.has(s.id)),
    [allScreens.data, memberIds],
  );

  // Drop any stale selections once the membership/candidate list changes.
  const candidateIds = useMemo(() => new Set(candidates.map((s) => s.id)), [candidates]);
  const visibleSelected = selected.filter((id) => candidateIds.has(id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleAdd = async () => {
    if (visibleSelected.length === 0) return;
    setAdding(true);
    try {
      await api.post(`/screen-groups/${group.id}/screens`, { screenIds: visibleSelected });
      toast(
        visibleSelected.length === 1 ? 'Screen added.' : `${visibleSelected.length} screens added.`,
        'success',
      );
      setSelected([]);
      detail.reload();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
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
      toast('Screen removed.', 'success');
      detail.reload();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setRemovingId(null);
    }
  };

  const loading = detail.loading || allScreens.loading;
  const loadError = detail.error || allScreens.error;

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Manage screens — ${group.name}`}
      description="Add or remove the screens that belong to this group."
      className="max-h-[90vh] max-w-2xl overflow-y-auto"
    >
      {loading && (
        <div className="flex justify-center py-10">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && loadError && (
        <EmptyState title="Could not load group" description={loadError ?? undefined} />
      )}

      {!loading && !loadError && (
        <div className="space-y-6">
          {/* Current members */}
          <section>
            <h3 className="mb-2 text-sm font-semibold">
              Members <span className="text-muted-foreground font-normal">({members.length})</span>
            </h3>
            {members.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                No screens in this group yet.
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
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add screens */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Add screens</h3>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={adding || visibleSelected.length === 0}
              >
                {adding && <Spinner className="size-3.5" />}
                Add{visibleSelected.length > 0 ? ` (${visibleSelected.length})` : ''}
              </Button>
            </div>
            {candidates.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                All available screens are already in this group.
              </p>
            ) : (
              <ul className="divide-border border-border max-h-64 divide-y overflow-y-auto rounded-lg border">
                {candidates.map((screen) => {
                  const checked = visibleSelected.includes(screen.id);
                  return (
                    <li key={screen.id}>
                      <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 transition">
                        <input
                          type="checkbox"
                          className="border-border accent-primary size-4 rounded"
                          checked={checked}
                          onChange={() => toggleSelect(screen.id)}
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
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
