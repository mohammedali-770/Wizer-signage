'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { BackupStatusResponse } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

const STATUS_TONE: Record<string, 'success' | 'danger' | 'warning'> = {
  SUCCESS: 'success',
  FAILED: 'danger',
  RUNNING: 'warning',
};

export default function BackupsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.adminBackups');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<BackupStatusResponse>('/admin/backups');
  const [busy, setBusy] = useState(false);

  // Backup run statuses (SUCCESS/FAILED/RUNNING) live in the central enums.status
  // group; fall back to the raw code for any unmapped status.
  const statusLabel = (code: string) => (te.has(`status.${code}`) ? te(`status.${code}`) : code);

  const runMaintenance = async () => {
    setBusy(true);
    try {
      await api.post('/admin/maintenance/run', { job: 'backup-check' });
      toast(t('toastRun'), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button variant="outline" onClick={runMaintenance} disabled={busy}>
            <RefreshCw className="size-4" /> {t('runHealthCheck')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data ? null : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard
              label={t('statLastBackup')}
              value={
                data.lastSuccessfulDatabaseBackupAt
                  ? formatDateTime(data.lastSuccessfulDatabaseBackupAt, locale)
                  : t('never')
              }
            />
            <StatCard
              label={t('statHealth')}
              value={data.stale ? t('overdue') : t('ok')}
              hint={t('overdueHint', { days: data.staleThresholdDays })}
            />
            <StatCard label={t('statRecentRuns')} value={data.recent.length} />
          </div>

          {data.stale ? (
            <Card className="mb-4 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600">
              {t('staleWarning')} <code>scripts/backup-db.sh</code> {t('staleWarningDocs')}
            </Card>
          ) : null}

          {data.recent.length === 0 ? (
            <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('colStarted')}</TH>
                  <TH>{tc('type')}</TH>
                  <TH>{tc('status')}</TH>
                  <TH>{t('colSize')}</TH>
                  <TH>{tc('location')}</TH>
                  <TH>{t('colFinished')}</TH>
                </TR>
              </THead>
              <TBody>
                {data.recent.map((b) => (
                  <TR key={b.id}>
                    <TD className="text-muted-foreground">{formatDateTime(b.startedAt, locale)}</TD>
                    <TD>{b.type}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>
                        {statusLabel(b.status)}
                      </Badge>
                      {b.error ? <p className="text-xs text-red-600">{b.error}</p> : null}
                    </TD>
                    <TD className="text-muted-foreground">
                      {b.sizeBytes ? `${(Number(b.sizeBytes) / 1_048_576).toFixed(1)} MB` : '—'}
                    </TD>
                    <TD className="text-muted-foreground max-w-xs truncate">{b.location ?? '—'}</TD>
                    <TD className="text-muted-foreground">
                      {b.finishedAt ? formatDateTime(b.finishedAt, locale) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
