'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { Alert, AlertStatus, Paginated } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { ExportButton } from '@/components/exports/export-button';
import {
  Badge,
  Button,
  EmptyState,
  Field,
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

const SEVERITY_TONE: Record<string, 'info' | 'warning' | 'danger'> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};
const STATUS_TONE: Record<AlertStatus, 'danger' | 'warning' | 'success' | 'neutral'> = {
  OPEN: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  DISMISSED: 'neutral',
};

export default function AlertsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.alerts');
  const tc = useTranslations('common');
  const { toast } = useToast();
  const [status, setStatus] = useState('OPEN');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (status) p.set('status', status);
    if (severity) p.set('severity', severity);
    return p.toString();
  }, [status, severity, page]);

  const { data, loading, error, reload } = useApiResource<Paginated<Alert> & { openCount: number }>(
    `/alerts?${query}`,
  );

  const act = async (id: string, action: string) => {
    setBusy(id + action);
    try {
      await api.post(`/alerts/${id}/${action}`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('actionFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<ExportButton dataset="alerts" filters={{ status: status || undefined }} />}
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <Field label={tc('status')}>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{tc('all')}</option>
            <option value="OPEN">{t('status.open')}</option>
            <option value="ACKNOWLEDGED">{t('status.acknowledged')}</option>
            <option value="RESOLVED">{t('status.resolved')}</option>
            <option value="DISMISSED">{t('status.dismissed')}</option>
          </Select>
        </Field>
        <Field label={t('severity.label')}>
          <Select
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{tc('all')}</option>
            <option value="INFO">{t('severity.info')}</option>
            <option value="WARNING">{t('severity.warning')}</option>
            <option value="CRITICAL">{t('severity.critical')}</option>
          </Select>
        </Field>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('column.when')}</TH>
                <TH>{t('severity.label')}</TH>
                <TH>{t('column.alert')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{tc('actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((a) => (
                <TR key={a.id}>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDateTime(a.triggeredAt, locale)}
                  </TD>
                  <TD>
                    <Badge tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>{a.severity}</Badge>
                  </TD>
                  <TD>
                    <p className="font-medium">{a.title}</p>
                    {a.message ? (
                      <p className="text-muted-foreground text-xs">{a.message}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                  </TD>
                  <TD>
                    {a.status === 'OPEN' || a.status === 'ACKNOWLEDGED' ? (
                      <div className="flex gap-1">
                        {a.status === 'OPEN' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === a.id + 'acknowledge'}
                            onClick={() => act(a.id, 'acknowledge')}
                          >
                            {t('action.ack')}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === a.id + 'resolve'}
                          onClick={() => act(a.id, 'resolve')}
                        >
                          {t('action.resolve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === a.id + 'dismiss'}
                          onClick={() => act(a.id, 'dismiss')}
                        >
                          {t('action.dismiss')}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {data.meta.totalPages > 1 ? (
            <div className="mt-4">
              <Pagination
                page={data.meta.page}
                totalPages={data.meta.totalPages}
                onPage={setPage}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
