'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil, Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { BillingInterval, Paginated, Plan, PlanLimits } from '@/lib/types';
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
const BILLING_INTERVALS: BillingInterval[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

/** The PlanLimits keys rendered as number inputs in the form. */
const LIMIT_FIELDS: { key: keyof PlanLimits; tkey: string }[] = [
  { key: 'maxCompanies', tkey: 'limits.maxCompanies' },
  { key: 'maxLocations', tkey: 'limits.maxLocations' },
  { key: 'maxScreens', tkey: 'limits.maxScreens' },
  { key: 'maxUsers', tkey: 'limits.maxUsers' },
  { key: 'storageGb', tkey: 'limits.storageGb' },
  { key: 'maxFileSizeMb', tkey: 'limits.maxFileSizeMb' },
  { key: 'autoScreenshotsPerDay', tkey: 'limits.autoScreenshotsPerDay' },
  { key: 'scheduledReports', tkey: 'limits.scheduledReports' },
  { key: 'dataRetentionDays', tkey: 'limits.dataRetentionDays' },
  { key: 'apiRequestsPerDay', tkey: 'limits.apiRequestsPerDay' },
  { key: 'webhooks', tkey: 'limits.webhooks' },
];

type LimitStrings = Record<keyof PlanLimits, string>;

interface FormState {
  name: string;
  code: string;
  description: string;
  price: string;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: string;
  isActive: boolean;
  isPublic: boolean;
  limits: LimitStrings;
}

function emptyLimits(): LimitStrings {
  return LIMIT_FIELDS.reduce((acc, f) => {
    acc[f.key] = '';
    return acc;
  }, {} as LimitStrings);
}

function blankForm(): FormState {
  return {
    name: '',
    code: '',
    description: '',
    price: '',
    currency: 'USD',
    billingInterval: 'MONTHLY',
    trialDays: '0',
    isActive: true,
    isPublic: true,
    limits: emptyLimits(),
  };
}

function formFromPlan(plan: Plan): FormState {
  const limits = emptyLimits();
  for (const { key } of LIMIT_FIELDS) {
    const value = plan.limits?.[key];
    limits[key] = value === null || value === undefined ? '' : String(value);
  }
  return {
    name: plan.name,
    code: plan.code,
    description: plan.description ?? '',
    price: plan.priceMonthly ?? '',
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: String(plan.trialDays ?? 0),
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    limits,
  };
}

/** Convert form limit strings to a PlanLimits payload; blanks omitted (unlimited). */
function limitsPayload(limits: LimitStrings): PlanLimits {
  const out: PlanLimits = {};
  for (const { key } of LIMIT_FIELDS) {
    const raw = limits[key].trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

export default function PlansPage() {
  const locale = useLocale();
  const t = useTranslations('pages.adminPlans');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const path = useMemo(() => `/plans?page=${page}&pageSize=${PAGE_SIZE}`, [page]);
  const { data, loading, error, reload } = useApiResource<Paginated<Plan>>(path);

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setDialogOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm(formFromPlan(plan));
    setDialogOpen(true);
  };

  const closeDialog = () => {
    if (saving) return;
    setDialogOpen(false);
  };

  const updateLimit = (key: keyof PlanLimits, value: string) =>
    setForm((f) => ({ ...f, limits: { ...f.limits, [key]: value } }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast(t('toast.nameRequired'), 'error');
      return;
    }
    if (!editing && !form.code.trim()) {
      toast(t('toast.codeRequired'), 'error');
      return;
    }

    setSaving(true);
    try {
      const limits = limitsPayload(form.limits);
      const base = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        // The API field is priceMonthly; `form.price` is local UI state.
        priceMonthly: form.price.trim() === '' ? 0 : Number(form.price),
        currency: form.currency.trim() || 'USD',
        billingInterval: form.billingInterval,
        trialDays: form.trialDays.trim() === '' ? 0 : Number(form.trialDays),
        isActive: form.isActive,
        isPublic: form.isPublic,
        limits,
      };

      if (editing) {
        await api.patch<Plan>(`/plans/${editing.id}`, base);
        toast(t('toast.updated'), 'success');
      } else {
        await api.post<Plan>('/plans', { ...base, code: form.code.trim() });
        toast(t('toast.created'), 'success');
      }
      setDialogOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.generic'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    setBusyId(plan.id);
    try {
      if (plan.isActive) {
        await api.post(`/plans/${plan.id}/archive`);
        toast(t('toast.archived'), 'success');
      } else {
        await api.post(`/plans/${plan.id}/activate`);
        toast(t('toast.activated'), 'success');
      }
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.generic'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const plans = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            {t('newPlan')}
          </Button>
        }
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && !loading && <EmptyState title={t('loadError')} description={error} />}
      {!loading && !error && plans.length === 0 && (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      )}

      {!loading && !error && plans.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{t('code')}</TH>
                <TH>{t('price')}</TH>
                <TH>{t('trialDays')}</TH>
                <TH>{tc('status')}</TH>
                <TH className="text-end">{tc('actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {plans.map((plan) => (
                <TR key={plan.id}>
                  <TD className="font-medium">{plan.name}</TD>
                  <TD>
                    <code className="bg-muted rounded px-1.5 py-0.5 text-xs">{plan.code}</code>
                  </TD>
                  <TD className="whitespace-nowrap">
                    {formatCurrency(plan.priceMonthly, plan.currency, locale)}
                    <span className="text-muted-foreground">
                      {' / '}
                      {t(`interval.${plan.billingInterval}`)}
                    </span>
                  </TD>
                  <TD>{formatNumber(plan.trialDays, locale)}</TD>
                  <TD>
                    <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                      {plan.isActive ? te('status.ACTIVE') : te('status.INACTIVE')}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(plan)}>
                        <Pencil className="size-3.5" />
                        {tc('edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant={plan.isActive ? 'ghost' : 'secondary'}
                        disabled={busyId === plan.id}
                        onClick={() => toggleActive(plan)}
                      >
                        {busyId === plan.id ? (
                          <Spinner className="size-3.5" />
                        ) : plan.isActive ? (
                          t('archive')
                        ) : (
                          t('activate')
                        )}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {data && (
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />
          )}
        </>
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        description={editing ? t('dialog.editDescription') : t('dialog.createDescription')}
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={tc('name')}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Pro"
                required
              />
            </Field>
            <Field label={t('code')} hint={editing ? t('hint.codeLocked') : t('hint.codeUnique')}>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="pro"
                disabled={!!editing}
                required={!editing}
              />
            </Field>
          </div>

          <Field label={tc('description')}>
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t('descriptionPlaceholder')}
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('price')}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
              />
            </Field>
            <Field label={t('currency')}>
              <Input
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                placeholder="USD"
                maxLength={3}
              />
            </Field>
            <Field label={t('billingInterval')}>
              <Select
                value={form.billingInterval}
                onChange={(e) =>
                  setForm((f) => ({ ...f, billingInterval: e.target.value as BillingInterval }))
                }
              >
                {BILLING_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {t(`interval.${interval}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label={t('trialDays')}>
              <Input
                type="number"
                min="0"
                value={form.trialDays}
                onChange={(e) => setForm((f) => ({ ...f, trialDays: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="plan-active"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              <Label htmlFor="plan-active" className="mb-0">
                {t('active')}
              </Label>
            </div>
            <div className="flex items-end gap-2 pb-2">
              <input
                id="plan-public"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={form.isPublic}
                onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))}
              />
              <Label htmlFor="plan-public" className="mb-0">
                {t('public')}
              </Label>
            </div>
          </div>

          <div className="border-border rounded-lg border p-4">
            <p className="text-sm font-medium">{t('limits.title')}</p>
            <p className="text-muted-foreground mb-3 text-xs">{t('limits.hint')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LIMIT_FIELDS.map(({ key, tkey }) => (
                <Field key={key} label={t(tkey)}>
                  <Input
                    type="number"
                    min="0"
                    value={form.limits[key]}
                    onChange={(e) => updateLimit(key, e.target.value)}
                    placeholder={t('limits.unlimited')}
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-4" />}
              {editing ? tc('save') : t('createPlan')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
