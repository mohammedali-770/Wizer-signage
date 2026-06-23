'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
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
const LIMIT_FIELDS: { key: keyof PlanLimits; label: string }[] = [
  { key: 'maxCompanies', label: 'Max companies' },
  { key: 'maxLocations', label: 'Max locations' },
  { key: 'maxScreens', label: 'Max screens' },
  { key: 'maxUsers', label: 'Max users' },
  { key: 'storageGb', label: 'Storage (GB)' },
  { key: 'maxFileSizeMb', label: 'Max file size (MB)' },
  { key: 'autoScreenshotsPerDay', label: 'Auto screenshots / day' },
  { key: 'scheduledReports', label: 'Scheduled reports' },
  { key: 'dataRetentionDays', label: 'Data retention (days)' },
  { key: 'apiRequestsPerDay', label: 'API requests / day' },
  { key: 'webhooks', label: 'Webhooks' },
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
      toast('Name is required.', 'error');
      return;
    }
    if (!editing && !form.code.trim()) {
      toast('Code is required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const limits = limitsPayload(form.limits);
      const base = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: form.price.trim() === '' ? 0 : Number(form.price),
        currency: form.currency.trim() || 'USD',
        billingInterval: form.billingInterval,
        trialDays: form.trialDays.trim() === '' ? 0 : Number(form.trialDays),
        isActive: form.isActive,
        isPublic: form.isPublic,
        limits,
      };

      if (editing) {
        await api.patch<Plan>(`/plans/${editing.id}`, base);
        toast('Plan updated.', 'success');
      } else {
        await api.post<Plan>('/plans', { ...base, code: form.code.trim() });
        toast('Plan created.', 'success');
      }
      setDialogOpen(false);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (plan: Plan) => {
    setBusyId(plan.id);
    try {
      if (plan.isActive) {
        await api.post(`/plans/${plan.id}/archive`);
        toast('Plan archived.', 'success');
      } else {
        await api.post(`/plans/${plan.id}/activate`);
        toast('Plan activated.', 'success');
      }
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const plans = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Plans"
        description="Define subscription tiers, pricing, and resource limits."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            New Plan
          </Button>
        }
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && !loading && <EmptyState title="Could not load plans" description={error} />}
      {!loading && !error && plans.length === 0 && (
        <EmptyState
          title="No plans yet"
          description="Create your first plan to start onboarding companies."
        />
      )}

      {!loading && !error && plans.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Code</TH>
                <TH>Price</TH>
                <TH>Trial days</TH>
                <TH>Status</TH>
                <TH className="text-end">Actions</TH>
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
                      {plan.billingInterval.toLowerCase()}
                    </span>
                  </TD>
                  <TD>{formatNumber(plan.trialDays, locale)}</TD>
                  <TD>
                    <Badge tone={plan.isActive ? 'success' : 'neutral'}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(plan)}>
                        <Pencil className="size-3.5" />
                        Edit
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
                          'Archive'
                        ) : (
                          'Activate'
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
        title={editing ? 'Edit Plan' : 'New Plan'}
        description={
          editing
            ? 'Update pricing, availability, and resource limits.'
            : 'Define a new subscription tier.'
        }
        className="max-h-[90vh] max-w-2xl overflow-y-auto"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Pro"
                required
              />
            </Field>
            <Field label="Code" hint={editing ? 'Code cannot be changed.' : 'Unique identifier.'}>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="pro"
                disabled={!!editing}
                required={!editing}
              />
            </Field>
          </div>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this plan includes."
              rows={2}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Price">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
              />
            </Field>
            <Field label="Currency">
              <Input
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                placeholder="USD"
                maxLength={3}
              />
            </Field>
            <Field label="Billing interval">
              <Select
                value={form.billingInterval}
                onChange={(e) =>
                  setForm((f) => ({ ...f, billingInterval: e.target.value as BillingInterval }))
                }
              >
                {BILLING_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval.charAt(0) + interval.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Trial days">
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
                Active
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
                Public
              </Label>
            </div>
          </div>

          <div className="border-border rounded-lg border p-4">
            <p className="text-sm font-medium">Limits</p>
            <p className="text-muted-foreground mb-3 text-xs">Leave a field blank for unlimited.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LIMIT_FIELDS.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <Input
                    type="number"
                    min="0"
                    value={form.limits[key]}
                    onChange={(e) => updateLimit(key, e.target.value)}
                    placeholder="Unlimited"
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className="border-border flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Spinner className="size-4" />}
              {editing ? 'Save changes' : 'Create plan'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
