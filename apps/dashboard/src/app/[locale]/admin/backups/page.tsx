'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
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
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<BackupStatusResponse>('/admin/backups');
  const [busy, setBusy] = useState(false);

  const runMaintenance = async () => {
    setBusy(true);
    try {
      await api.post('/admin/maintenance/run', { job: 'backup-check' });
      toast('Backup health check run.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Backups"
        description="Database backup health. Backups run from scripts/backup-db.sh via cron and record here."
        actions={
          <Button variant="outline" onClick={runMaintenance} disabled={busy}>
            <RefreshCw className="size-4" /> Run health check
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load backup status" description={error} />
      ) : !data ? null : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Last successful DB backup"
              value={
                data.lastSuccessfulDatabaseBackupAt
                  ? formatDateTime(data.lastSuccessfulDatabaseBackupAt, locale)
                  : 'Never'
              }
            />
            <StatCard
              label="Health"
              value={data.stale ? 'Overdue' : 'OK'}
              hint={`> ${data.staleThresholdDays}d = overdue`}
            />
            <StatCard label="Recent runs" value={data.recent.length} />
          </div>

          {data.stale ? (
            <Card className="mb-4 border-red-500/40 bg-red-500/5 p-4 text-sm text-red-600">
              No recent successful database backup. Check the backup cron job and{' '}
              <code>scripts/backup-db.sh</code> (see docs/backup-restore.md).
            </Card>
          ) : null}

          {data.recent.length === 0 ? (
            <EmptyState
              title="No backup runs recorded"
              description="Run scripts/backup-db.sh (it records a run here)."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Started</TH>
                  <TH>Type</TH>
                  <TH>Status</TH>
                  <TH>Size</TH>
                  <TH>Location</TH>
                  <TH>Finished</TH>
                </TR>
              </THead>
              <TBody>
                {data.recent.map((b) => (
                  <TR key={b.id}>
                    <TD className="text-muted-foreground">{formatDateTime(b.startedAt, locale)}</TD>
                    <TD>{b.type}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[b.status] ?? 'neutral'}>{b.status}</Badge>
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
