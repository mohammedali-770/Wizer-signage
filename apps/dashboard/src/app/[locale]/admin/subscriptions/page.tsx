'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export default function SubscriptionsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.adminSubscriptions');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
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
      toast(t('toast.selectCompanyPlan'), 'error');
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
      toast(t('toast.created'), 'success');
      setCreateOpen(false);
      resetCreate();
      reload();
    } catch (e) {
      toast(errorMessage(e, t('toast.generic')), 'error');
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
      toast(t('toast.selectPlan'), 'error');
      return;
    }
    setChanging(true);
    try {
      const body: Record<string, unknown> = { planId: changePlanId };
      if (changeStatus) body.status = changeStatus;
      await api.patch(`/subscriptions/${changeTarget.id}`, body);
      toast(t('toast.updated'), 'success');
      setChangeTarget(null);
      reload();
    } catch (e) {
      toast(errorMessage(e, t('toast.generic')), 'error');
    } finally {
      setChanging(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/subscriptions/${cancelTarget.id}/cancel`);
      toast(t('toast.cancelled'), 'success');
      setCancelTarget(null);
      reload();
    } catch (e) {
      toast(errorMessage(e, t('toast.generic')), 'error');
    } finally {
      setCancelling(false);
    }
  }

  const items = data?.items ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            {t('newSubscription')}
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
            aria-label={t('filterByStatus')}
          >
            <option value="">{t('allStatuses')}</option>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {te(`status.${s}`)}
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

      {error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('company')}</TH>
                <TH>{t('plan')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{t('trialEnds')}</TH>
                <TH>{t('currentPeriod')}</TH>
                <TH>{t('graceEnds')}</TH>
                <TH className="text-end">{tc('actions')}</TH>
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
                          {t('changePlan')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={cancelled}
                          onClick={() => setCancelTarget(sub)}
                        >
                          {tc('cancel')}
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
        title={t('dialog.createTitle')}
        description={t('dialog.createDescription')}
      >
        <div className="space-y-4">
          <Field label={t('company')}>
            <Select value={createCompanyId} onChange={(e) => setCreateCompanyId(e.target.value)}>
              <option value="">{t('selectCompany')}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('plan')}>
            <Select value={createPlanId} onChange={(e) => setCreatePlanId(e.target.value)}>
              <option value="">{t('selectPlan')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tc('status')}>
            <Select
              value={createStatus}
              onChange={(e) => setCreateStatus(e.target.value as SubscriptionStatus)}
            >
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {te(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('trialDays')} hint={t('hint.trialDays')}>
            <input
              type="number"
              min={0}
              value={createTrialDays}
              onChange={(e) => setCreateTrialDays(e.target.value)}
              placeholder={t('trialDaysPlaceholder')}
              className="border-border bg-background placeholder:text-muted-foreground focus-visible:ring-primary/40 h-10 w-full rounded-md border px-3 text-sm outline-none transition focus-visible:ring-2"
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Spinner className="size-4" />}
              {tc('create')}
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
        title={t('dialog.changeTitle')}
        description={changeTarget?.company?.name ?? undefined}
      >
        <div className="space-y-4">
          <Field label={t('plan')}>
            <Select value={changePlanId} onChange={(e) => setChangePlanId(e.target.value)}>
              <option value="">{t('selectPlan')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={tc('status')} hint={t('hint.changeStatus')}>
            <Select
              value={changeStatus}
              onChange={(e) => setChangeStatus(e.target.value as SubscriptionStatus | '')}
            >
              <option value="">{t('keepStatus')}</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {te(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setChangeTarget(null)} disabled={changing}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleChange} disabled={changing}>
              {changing && <Spinner className="size-4" />}
              {tc('save')}
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
        title={t('dialog.cancelTitle')}
        description={
          cancelTarget?.company?.name
            ? t('dialog.cancelDescriptionNamed', { name: cancelTarget.company.name })
            : t('dialog.cancelDescription')
        }
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
            {t('keepSubscription')}
          </Button>
          <Button variant="danger" onClick={handleCancel} disabled={cancelling}>
            {cancelling && <Spinner className="size-4" />}
            {t('cancelSubscription')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
