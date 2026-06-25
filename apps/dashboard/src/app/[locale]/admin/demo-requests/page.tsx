'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { DemoRequest, DemoRequestStatus, Paginated } from '@/lib/types';
import {
  EmptyState,
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
  useToast,
} from '@/components/ui';

const PAGE_SIZE = 20;
const STATUSES: DemoRequestStatus[] = ['NEW', 'CONTACTED', 'SCHEDULED', 'CLOSED'];

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

export default function AdminDemoRequestsPage() {
  const t = useTranslations('pages.adminDemoRequests');
  const te = useTranslations('enums.demoStatus');
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | DemoRequestStatus>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) params.set('status', status);
    return `/super-admin/demo-requests?${params.toString()}`;
  }, [page, status]);

  const { data, loading, error, reload } = useApiResource<Paginated<DemoRequest>>(path);

  async function changeStatus(id: string, next: DemoRequestStatus) {
    setBusyId(id);
    try {
      await api.patch(`/super-admin/demo-requests/${id}`, { status: next });
      toast(t('toastUpdated'), 'success');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="mb-4 max-w-xs">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | DemoRequestStatus);
            setPage(1);
          }}
        >
          <option value="">{t('allStatuses')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {te(s)}
            </option>
          ))}
        </Select>
      </div>

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
                <TH>{t('colName')}</TH>
                <TH>{t('colCompany')}</TH>
                <TH>{t('colContact')}</TH>
                <TH>{t('colScreens')}</TH>
                <TH>{t('colDate')}</TH>
                <TH>{t('colStatus')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium">{r.name}</div>
                    {r.message ? (
                      <div
                        className="text-muted-foreground max-w-xs truncate text-xs"
                        title={r.message}
                      >
                        {r.message}
                      </div>
                    ) : null}
                  </TD>
                  <TD>{r.companyName ?? '—'}</TD>
                  <TD>
                    <div className="text-sm">{r.email}</div>
                    <div className="text-muted-foreground text-xs" dir="ltr">
                      {r.phone ?? '—'}
                    </div>
                  </TD>
                  <TD>{r.screens ?? '—'}</TD>
                  <TD>{fmtDate(r.createdAt)}</TD>
                  <TD>
                    <Select
                      value={r.status}
                      disabled={busyId === r.id}
                      onChange={(e) => changeStatus(r.id, e.target.value as DemoRequestStatus)}
                      className="min-w-[8rem]"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {te(s)}
                        </option>
                      ))}
                    </Select>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={data.meta.totalPages} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
