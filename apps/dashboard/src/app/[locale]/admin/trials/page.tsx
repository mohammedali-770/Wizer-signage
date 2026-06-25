'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { api, ApiError } from '@/lib/api';
import { Link } from '@/i18n/navigation';
import { useApiResource } from '@/lib/use-api';
import type { Paginated, Subscription } from '@/lib/types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

const PAGE_SIZE = 20;

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function AdminTrialsPage() {
  const t = useTranslations('pages.adminTrials');
  const tc = useTranslations('common');
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [disableTarget, setDisableTarget] = useState<{ companyId: string; name: string } | null>(
    null,
  );

  const { data, loading, error, reload } = useApiResource<Paginated<Subscription>>(
    `/subscriptions?status=TRIALING&page=${page}&pageSize=${PAGE_SIZE}`,
  );

  function toastErr(e: unknown) {
    toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
  }

  async function convert(id: string) {
    setBusyId(id);
    try {
      await api.patch(`/subscriptions/${id}`, { status: 'ACTIVE' });
      toast(t('toastConverted'), 'success');
      reload();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusyId(null);
    }
  }

  async function extend(s: Subscription) {
    setBusyId(s.id);
    try {
      const base =
        s.trialEndsAt && new Date(s.trialEndsAt) > new Date()
          ? new Date(s.trialEndsAt)
          : new Date();
      base.setDate(base.getDate() + 14);
      await api.patch(`/subscriptions/${s.id}`, { trialEndsAt: base.toISOString() });
      toast(t('toastExtended'), 'success');
      reload();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusyId(null);
    }
  }

  async function disable() {
    if (!disableTarget) return;
    setBusyId(disableTarget.companyId);
    try {
      await api.post(`/companies/${disableTarget.companyId}/suspend`, {});
      toast(t('toastDisabled'), 'success');
      setDisableTarget(null);
      reload();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && <EmptyState title={t('loadError')} description={error} />}

      {data && data.items.length === 0 && <EmptyState title={t('none')} />}

      {data && data.items.length > 0 && (
        <div className="space-y-4">
          <Table>
            <THead>
              <TR>
                <TH>{t('colCompany')}</TH>
                <TH>{t('colPlan')}</TH>
                <TH>{t('colTrialEnds')}</TH>
                <TH>{t('colDaysLeft')}</TH>
                <TH>{t('colActions')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((s) => {
                const left = daysLeft(s.trialEndsAt);
                const expired = left !== null && left <= 0;
                return (
                  <TR key={s.id}>
                    <TD>
                      <Link
                        href={`/admin/companies/${s.companyId}`}
                        className="font-medium hover:underline"
                      >
                        {s.company?.name ?? s.companyId}
                      </Link>
                      <div className="text-muted-foreground text-xs">{s.company?.slug}</div>
                    </TD>
                    <TD>{s.plan?.name ?? '—'}</TD>
                    <TD>{fmtDate(s.trialEndsAt)}</TD>
                    <TD>
                      {left === null ? (
                        '—'
                      ) : expired ? (
                        <Badge tone="danger">{t('expired')}</Badge>
                      ) : (
                        <Badge tone={left <= 3 ? 'warning' : 'neutral'}>
                          {t('daysLeft', { n: left })}
                        </Badge>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busyId === s.id}
                          onClick={() => convert(s.id)}
                        >
                          {t('convert')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === s.id}
                          onClick={() => extend(s)}
                        >
                          {t('extend')}
                        </Button>
                        <Link
                          href={`/admin/companies/${s.companyId}`}
                          className="border-border hover:bg-muted inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium"
                        >
                          {t('view')}
                        </Link>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId === s.companyId}
                          onClick={() =>
                            setDisableTarget({
                              companyId: s.companyId,
                              name: s.company?.name ?? s.companyId,
                            })
                          }
                        >
                          {t('disable')}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={data.meta.totalPages} onPage={setPage} />
        </div>
      )}

      <Dialog
        open={disableTarget !== null}
        onClose={() => setDisableTarget(null)}
        title={t('disableTitle')}
        description={t('disableConfirm', { name: disableTarget?.name ?? '' })}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDisableTarget(null)}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" disabled={busyId !== null} onClick={disable}>
            {t('disable')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
