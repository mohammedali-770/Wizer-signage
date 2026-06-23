'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatDate } from '@/lib/format';
import type {
  Paginated,
  Subscription,
  SubscriptionStatus,
  CompanyListItem,
  Plan,
} from '@/lib/types';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'ACTIVE',
  'TRIALING',
  'EXPIRED',
  'SUSPENDED',
  'CANCELLED',
];

const PAGE_SIZE = 20;

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong.';
}

export default function SubscriptionsPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<SubscriptionStatus | ''>('');

  const listPath = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (statusFilter) params.set('status', statusFilter);
    return `/subscriptions?${params.toString()}`;
  }, [page, statusFilter]);

  const { data, loading, error, reload } = useApiResource<Paginated<Subscription>>(listPath);

  // Lookups for create dialog selects.
  const { data: companiesData } =
    useApiResource<Paginated<CompanyListItem>>('/companies?pageSize=100');
  const { data: plansData } = useApiResource<Paginated<Plan>>('/plans?pageSize=100&isActive=true');
  const companies = companiesData?.items ?? [];
  const plans = plansData?.items ?? [];

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState('');
  const [createPlanId, setCreatePlanId] = useState('');
  const [createStatus, setCreateStatus] = useState<SubscriptionStatus>('ACTIVE');
  const [createTrialDays, setCreateTrialDays] = useState('');
  const [creating, setCreating] = useState(false);

  // Change-plan dialog state.
  const [changeTarget, setChangeTarget] = useState<Subscription | null>(null);
  const [changePlanId, setChangePlanId] = useState('');
  const [changeStatus, setChangeStatus] = useState<SubscriptionStatus | ''>('');
  const [changing, setChanging] = useState(false);

  // Cancel dialog state.
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [cancelling, setCancelling] = useState(false);

  function resetCreate() {
    setCreateCompanyId('');
    setCreatePlanId('');
    setCreateStatus('ACTIVE');
    setCreateTrialDays('');
  }

  async function handleCreate() {
    if (!createCompanyId || !createPlanId) {
      toast('Select a company and a plan.', 'error');
      return;
    }
    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        companyId: createCompanyId,
        planId: createPlanId,
        status: createStatus,
      };
      const trial = Number(createTrialDays);
      if (createTrialDays !== '' && Number.isFinite(trial)) body.trialDays = trial;
      await api.post('/subscriptions', body);
      toast('Subscription created.', 'success');
      setCreateOpen(false);
      resetCreate();
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setCreating(false);
    }
  }

  function openChange(sub: Subscription) {
    setChangeTarget(sub);
    setChangePlanId(sub.planId);
    setChangeStatus('');
  }

  async function handleChange() {
    if (!changeTarget) return;
    if (!changePlanId) {
      toast('Select a plan.', 'error');
      return;
    }
    setChanging(true);
    try {
      const body: Record<string, unknown> = { planId: changePlanId };
      if (changeStatus) body.status = changeStatus;
      await api.patch(`/subscriptions/${changeTarget.id}`, body);
      toast('Subscription updated.', 'success');
      setChangeTarget(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setChanging(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/subscriptions/${cancelTarget.id}/cancel`);
      toast('Subscription cancelled.', 'success');
      setCancelTarget(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setCancelling(false);
    }
  }

  const items = data?.items ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Manage tenant subscriptions, plan changes and cancellations."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Subscription
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="w-48">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as SubscriptionStatus | '');
              setPage(1);
            }}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {error && <EmptyState title="Could not load subscriptions" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No subscriptions found"
          description="Create a subscription or adjust the status filter."
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Company</TH>
                <TH>Plan</TH>
                <TH>Status</TH>
                <TH>Trial ends</TH>
                <TH>Current period</TH>
                <TH>Grace ends</TH>
                <TH className="text-end">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((sub) => {
                const cancelled = sub.status === 'CANCELLED';
                return (
                  <TR key={sub.id}>
                    <TD className="font-medium">{sub.company?.name ?? '—'}</TD>
                    <TD>{sub.plan?.name ?? '—'}</TD>
                    <TD>
                      <StatusBadge status={sub.status} />
                    </TD>
                    <TD>{sub.trialEndsAt ? formatDate(sub.trialEndsAt, locale) : '—'}</TD>
                    <TD className="whitespace-nowrap">
                      {sub.currentPeriodStart || sub.currentPeriodEnd ? (
                        <>
                          {sub.currentPeriodStart
                            ? formatDate(sub.currentPeriodStart, locale)
                            : '—'}
                          {' – '}
                          {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, locale) : '—'}
                        </>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      {sub.gracePeriodEndsAt ? formatDate(sub.gracePeriodEndsAt, locale) : '—'}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openChange(sub)}>
                          Change plan
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={cancelled}
                          onClick={() => setCancelTarget(sub)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}

      {/* Create subscription */}
      <Dialog
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false);
        }}
        title="New Subscription"
        description="Assign a plan to a company."
      >
        <div className="space-y-4">
          <Field label="Company">
            <Select value={createCompanyId} onChange={(e) => setCreateCompanyId(e.target.value)}>
              <option value="">Select a company…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Plan">
            <Select value={createPlanId} onChange={(e) => setCreatePlanId(e.target.value)}>
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status">
            <Select
              value={createStatus}
              onChange={(e) => setCreateStatus(e.target.value as SubscriptionStatus)}
            >
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Trial days" hint="Optional. Leave blank to use the plan default.">
            <input
              type="number"
              min={0}
              value={createTrialDays}
              onChange={(e) => setCreateTrialDays(e.target.value)}
              placeholder="e.g. 14"
              className="border-border bg-background placeholder:text-muted-foreground focus-visible:ring-primary/40 h-10 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Spinner className="size-4" />}
              Create
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Change plan */}
      <Dialog
        open={changeTarget !== null}
        onClose={() => {
          if (!changing) setChangeTarget(null);
        }}
        title="Change plan"
        description={changeTarget?.company?.name ?? undefined}
      >
        <div className="space-y-4">
          <Field label="Plan">
            <Select value={changePlanId} onChange={(e) => setChangePlanId(e.target.value)}>
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" hint="Optional. Leave unchanged to keep the current status.">
            <Select
              value={changeStatus}
              onChange={(e) => setChangeStatus(e.target.value as SubscriptionStatus | '')}
            >
              <option value="">Keep current status</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setChangeTarget(null)} disabled={changing}>
              Cancel
            </Button>
            <Button onClick={handleChange} disabled={changing}>
              {changing && <Spinner className="size-4" />}
              Save changes
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Cancel confirmation */}
      <Dialog
        open={cancelTarget !== null}
        onClose={() => {
          if (!cancelling) setCancelTarget(null);
        }}
        title="Cancel subscription"
        description={
          cancelTarget?.company?.name
            ? `This will cancel the subscription for ${cancelTarget.company.name}.`
            : 'This will cancel the subscription.'
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
            Keep subscription
          </Button>
          <Button variant="danger" onClick={handleCancel} disabled={cancelling}>
            {cancelling && <Spinner className="size-4" />}
            Cancel subscription
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
