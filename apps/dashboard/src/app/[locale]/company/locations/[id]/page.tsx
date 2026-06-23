'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.locationDetail');
  const tc = useTranslations('common');

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
      toast(t('toast.nameRequired'), 'error');
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
      toast(t('toast.updated'), 'success');
      setEditOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.genericError'), 'error');
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
      toast(err instanceof ApiError ? err.message : t('toast.genericError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFallbackChange = (contentId: string | null) =>
    runAction(
      () => api.patch(`/locations/${id}`, { fallbackContentId: contentId }),
      contentId ? t('toast.fallbackUpdated') : t('toast.fallbackCleared'),
    );

  const onDeactivate = () =>
    runAction(() => api.post(`/locations/${id}/deactivate`), t('toast.deactivated'));

  const onReactivate = () =>
    runAction(() => api.post(`/locations/${id}/reactivate`), t('toast.reactivated'));

  const onArchive = () =>
    runAction(
      () => api.post(`/locations/${id}/archive`),
      t('toast.archived'),
      () => {
        setArchiveOpen(false);
        reload();
      },
    );

  const onDelete = () =>
    runAction(
      () => api.del(`/locations/${id}`),
      t('toast.deleted'),
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
        {t('backToLocations')}
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

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
                  {t('codeLabel')}{' '}
                  <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{data.code}</code>
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="size-4" />
                {tc('edit')}
              </Button>
              {data.status === 'ACTIVE' && (
                <Button variant="outline" onClick={onDeactivate} disabled={busy}>
                  {t('actions.deactivate')}
                </Button>
              )}
              {data.status === 'INACTIVE' && (
                <Button variant="secondary" onClick={onReactivate} disabled={busy}>
                  {t('actions.reactivate')}
                </Button>
              )}
              {data.status !== 'ARCHIVED' && (
                <Button variant="ghost" onClick={() => setArchiveOpen(true)} disabled={busy}>
                  {t('actions.archive')}
                </Button>
              )}
              <Button variant="danger" onClick={() => setDeleteOpen(true)} disabled={busy}>
                {tc('delete')}
              </Button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            <StatCard
              label={t('metrics.totalScreens')}
              value={formatNumber(data.metrics.total, locale)}
            />
            <StatCard
              label={t('metrics.online')}
              value={formatNumber(data.metrics.online, locale)}
            />
            <StatCard
              label={t('metrics.offline')}
              value={formatNumber(data.metrics.offline, locale)}
            />
            <StatCard
              label={t('metrics.warning')}
              value={formatNumber(data.metrics.warning, locale)}
            />
            <StatCard label={t('metrics.other')} value={formatNumber(data.metrics.other, locale)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('cards.details')}</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <DetailRow
                  label={tc('description')}
                  value={data.description ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.address')}
                  value={data.address ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.city')}
                  value={data.city ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.region')}
                  value={data.region ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.country')}
                  value={data.country ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.timezone')}
                  value={data.timezone ?? <span className="text-muted-foreground">—</span>}
                />
                <DetailRow
                  label={t('fields.coordinates')}
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
                <CardTitle>{t('cards.metadata')}</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <DetailRow label={tc('status')} value={<StatusBadge status={data.status} />} />
                <DetailRow
                  label={t('fields.workingHours')}
                  value={
                    data.workingHours ? (
                      t('fields.configured')
                    ) : (
                      <span className="text-muted-foreground">{t('fields.notSet')}</span>
                    )
                  }
                />
                <DetailRow label={tc('created')} value={formatDate(data.createdAt, locale)} />
                <DetailRow label={tc('updated')} value={formatDate(data.updatedAt, locale)} />
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t('cards.fallbackContent')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">{t('fallbackHint')}</p>
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
        title={t('editDialog.title')}
        description={t('editDialog.description')}
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        {form && (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={tc('name')}>
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder={t('placeholders.name')}
                  required
                />
              </Field>
              <Field label={t('fields.code')}>
                <Input
                  value={form.code}
                  onChange={(e) => update('code', e.target.value)}
                  placeholder={t('placeholders.code')}
                />
              </Field>
            </div>

            <Field label={tc('description')}>
              <Textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={2}
              />
            </Field>

            <Field label={t('fields.address')}>
              <Input value={form.address} onChange={(e) => update('address', e.target.value)} />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t('fields.city')}>
                <Input value={form.city} onChange={(e) => update('city', e.target.value)} />
              </Field>
              <Field label={t('fields.region')}>
                <Input value={form.region} onChange={(e) => update('region', e.target.value)} />
              </Field>
              <Field label={t('fields.country')}>
                <Input value={form.country} onChange={(e) => update('country', e.target.value)} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label={t('fields.timezone')}>
                <Input
                  value={form.timezone}
                  onChange={(e) => update('timezone', e.target.value)}
                  placeholder="Asia/Riyadh"
                />
              </Field>
              <Field label={t('fields.latitude')}>
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => update('latitude', e.target.value)}
                />
              </Field>
              <Field label={t('fields.longitude')}>
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => update('longitude', e.target.value)}
                />
              </Field>
            </div>

            <div className="border-border rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">{t('fields.workingHours')}</p>
              <WorkingHoursEditor value={editWorkingHours} onChange={setEditWorkingHours} />
            </div>

            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={closeEdit} disabled={saving}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Spinner className="size-4" />}
                {t('editDialog.submit')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Archive confirmation */}
      <Dialog
        open={archiveOpen}
        onClose={() => (busy ? undefined : setArchiveOpen(false))}
        title={t('archiveDialog.title')}
        description={t('archiveDialog.description')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setArchiveOpen(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" onClick={onArchive} disabled={busy}>
            {busy && <Spinner className="size-4" />}
            {t('actions.archive')}
          </Button>
        </div>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={deleteOpen}
        onClose={() => (busy ? undefined : setDeleteOpen(false))}
        title={t('deleteDialog.title')}
        description={t('deleteDialog.description')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" onClick={onDelete} disabled={busy}>
            {busy && <Spinner className="size-4" />}
            {tc('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
