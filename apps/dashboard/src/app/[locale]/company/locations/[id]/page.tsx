'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowLeft, Pencil } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatDate, formatNumber } from '@/lib/format';
import type { LocationDetail, WorkingHours } from '@/lib/types';
import { Link, useRouter } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import { FallbackContentPicker } from '@/components/content/fallback-content-picker';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  Spinner,
  StatCard,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui';

interface FormState {
  name: string;
  code: string;
  description: string;
  address: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  latitude: string;
  longitude: string;
}

function formFromLocation(loc: LocationDetail): FormState {
  return {
    name: loc.name,
    code: loc.code ?? '',
    description: loc.description ?? '',
    address: loc.address ?? '',
    city: loc.city ?? '',
    region: loc.region ?? '',
    country: loc.country ?? '',
    timezone: loc.timezone ?? '',
    latitude: loc.latitude === null ? '' : String(loc.latitude),
    longitude: loc.longitude === null ? '' : String(loc.longitude),
  };
}

/** Parse a number string into a finite number or null (blank/invalid -> null). */
function numberOrNull(value: string): number | null {
  const raw = value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-border flex flex-col gap-0.5 border-b py-2.5 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="text-foreground text-sm font-medium">{value}</span>
    </div>
  );
}

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();

  const { data, loading, error, reload } = useApiResource<LocationDetail>(`/locations/${id}`);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [editWorkingHours, setEditWorkingHours] = useState<WorkingHours | null>(null);
  const [saving, setSaving] = useState(false);

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openEdit = () => {
    if (!data) return;
    setForm(formFromLocation(data));
    setEditWorkingHours(data.workingHours);
    setEditOpen(true);
  };

  const closeEdit = () => {
    if (saving) return;
    setEditOpen(false);
  };

  const update = (key: keyof FormState, value: string) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !data) return;
    if (!form.name.trim()) {
      toast('Name is required.', 'error');
      return;
    }

    setSaving(true);
    try {
      await api.patch<LocationDetail>(`/locations/${data.id}`, {
        name: form.name.trim(),
        code: form.code.trim() || null,
        description: form.description.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        region: form.region.trim() || null,
        country: form.country.trim() || null,
        timezone: form.timezone.trim() || null,
        latitude: numberOrNull(form.latitude),
        longitude: numberOrNull(form.longitude),
        workingHours: editWorkingHours,
      });
      toast('Location updated.', 'success');
      setEditOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    action: () => Promise<unknown>,
    successMsg: string,
    after?: () => void,
  ) => {
    setBusy(true);
    try {
      await action();
      toast(successMsg, 'success');
      if (after) after();
      else reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFallbackChange = (contentId: string | null) =>
    runAction(
      () => api.patch(`/locations/${id}`, { fallbackContentId: contentId }),
      contentId ? 'Fallback content updated.' : 'Fallback content cleared.',
    );

  const onDeactivate = () =>
    runAction(() => api.post(`/locations/${id}/deactivate`), 'Location deactivated.');

  const onReactivate = () =>
    runAction(() => api.post(`/locations/${id}/reactivate`), 'Location reactivated.');

  const onArchive = () =>
    runAction(
      () => api.post(`/locations/${id}/archive`),
      'Location archived.',
      () => {
        setArchiveOpen(false);
        reload();
      },
    );

  const onDelete = () =>
    runAction(
      () => api.del(`/locations/${id}`),
      'Location deleted.',
      () => {
        setDeleteOpen(false);
        router.push('/company/locations');
      },
    );

  return (
    <div>
      <Link
        href="/company/locations"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        Back to locations
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load location" description={error} />}

      {!loading && !error && data && (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
                <StatusBadge status={data.status} />
              </div>
              {data.code ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  Code: <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{data.code}</code>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="size-4" />
                Edit
              </Button>
              {data.status === 'ACTIVE' && (
                <Button variant="outline" onClick={onDeactivate} disabled={busy}>
                  Deactivate
                </Button>
              )}
              {data.status === 'INACTIVE' && (
                <Button variant="secondary" onClick={onReactivate} disabled={busy}>
                  Reactivate
                </Button>
              )}
              {data.status !== 'ARCHIVED' && (
                <Button variant="ghost" onClick={() => setArchiveOpen(true)} disabled={busy}>
                  Archive
                </Button>
              )}
              <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
                Delete
              </Button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard label="Total screens" value={formatNumber(data.metrics.total, locale)} />
            <StatCard label="Online" value={formatNumber(data.metrics.online, locale)} />
            <StatCard label="Offline" value={formatNumber(data.metrics.offline, locale)} />
            <StatCard label="Warning" value={formatNumber(data.metrics.warning, locale)} />
            <StatCard label="Other" value={formatNumber(data.metrics.other, locale)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <DetailRow
                  label="Description"
                  value={data.description ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="Address"
                  value={data.address ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="City"
                  value={data.city ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="Region"
                  value={data.region ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="Country"
                  value={data.country ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="Timezone"
                  value={data.timezone ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label="Coordinates"
                  value={
                    data.latitude !== null && data.longitude !== null ? (
                      `${data.latitude}, ${data.longitude}`
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <DetailRow label="Status" value={<StatusBadge status={data.status} />} />
                <DetailRow
                  label="Working hours"
                  value={
                    data.workingHours ? (
                      'Configured'
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )
                  }
                />
                <DetailRow label="Created" value={formatDate(data.createdAt, locale)} />
                <DetailRow label="Updated" value={formatDate(data.updatedAt, locale)} />
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Fallback content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Shown on screens at this location when no playlist or schedule is active. Overrides
                the company default. Screens at this location may have mixed orientations, so pick
                content that suits them all (or set a per-screen fallback). Only ACTIVE content can
                be chosen.
              </p>
              <FallbackContentPicker
                value={data.fallbackContentId}
                onChange={onFallbackChange}
                busy={busy}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onClose={closeEdit}
        title="Edit Location"
        description="Update this location's details and working hours."
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        {form && (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Main Branch"
                  required
                />
              </Field>
              <Field label="Code">
                <Input
                  value={form.code}
                  onChange={(e) => update('code', e.target.value)}
                  placeholder="MB-01"
                />
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={2}
              />
            </Field>

            <Field label="Address">
              <Input value={form.address} onChange={(e) => update('address', e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input value={form.city} onChange={(e) => update('city', e.target.value)} />
              </Field>
              <Field label="Region">
                <Input value={form.region} onChange={(e) => update('region', e.target.value)} />
              </Field>
              <Field label="Country">
                <Input value={form.country} onChange={(e) => update('country', e.target.value)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Timezone">
                <Input
                  value={form.timezone}
                  onChange={(e) => update('timezone', e.target.value)}
                  placeholder="Asia/Riyadh"
                />
              </Field>
              <Field label="Latitude">
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => update('latitude', e.target.value)}
                />
              </Field>
              <Field label="Longitude">
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => update('longitude', e.target.value)}
                />
              </Field>
            </div>

            <div className="border-border rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">Working hours</p>
              <WorkingHoursEditor value={editWorkingHours} onChange={setEditWorkingHours} />
            </div>

            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={closeEdit} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Spinner className="size-4" />}
                Save changes
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Archive confirmation */}
      <Dialog
        open={archiveOpen}
        onClose={() => (busy ? undefined : setArchiveOpen(false))}
        title="Archive location"
        description="Archived locations are hidden from active lists. You can still view this location, but its screens will no longer count toward usage."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setArchiveOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onArchive} disabled={busy}>
            {busy && <Spinner className="size-4" />}
            Archive
          </Button>
        </div>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => (busy ? undefined : setDeleteOpen(false))}
        title="Delete location"
        description="This permanently deletes the location. This action cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            {busy && <Spinner className="size-4" />}
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
