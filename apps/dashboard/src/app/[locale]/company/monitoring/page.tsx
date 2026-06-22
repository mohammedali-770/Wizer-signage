'use client';

import { useLocale } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { ExportButton } from '@/components/exports/export-button';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { LiveScreenStatus, MonitoringOverview } from '@/lib/types';
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
import { useState } from 'react';

const STATUS_TONE: Record<LiveScreenStatus, 'success' | 'danger' | 'warning' | 'neutral' | 'info'> =
  {
    ONLINE: 'success',
    OFFLINE: 'danger',
    WARNING: 'warning',
    UNPAIRED: 'neutral',
    PAIRING: 'info',
    DISABLED: 'danger',
    ARCHIVED: 'neutral',
  };

export default function MonitoringPage() {
  const locale = useLocale();
  const { toast } = useToast();
  const { data, loading, error, reload } =
    useApiResource<MonitoringOverview>('/monitoring/overview');
  const [busy, setBusy] = useState<string | null>(null);

  const action = async (screenId: string, path: string, label: string) => {
    setBusy(screenId + path);
    try {
      await api.post(`/screens/${screenId}/actions/${path}`);
      toast(`${label} requested.`, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Monitoring"
        description="Fleet health, sync status, and remote control."
        actions={
          <div className="flex gap-2">
            <ExportButton dataset="screen-health" label="Export health" />
            <Button variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load monitoring" description={error} />
      ) : !data ? null : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Screens" value={data.totals.total} />
            <StatCard label="Online" value={data.totals.online} />
            <StatCard
              label="Offline"
              value={data.totals.offline}
              hint={`${data.missingHeartbeat} missing heartbeat`}
            />
            <StatCard label="Warning" value={data.totals.warning} />
            <StatCard label="Unpaired" value={data.totals.unpaired} />
            <StatCard label="Failed sync" value={data.withFailedDownloads} />
          </div>

          {data.alerts.length > 0 ? (
            <Card className="mb-4 p-4">
              <p className="mb-2 text-sm font-semibold">Alerts</p>
              <ul className="space-y-1">
                {data.alerts.map((a) => (
                  <li key={a.screenId + a.message} className="text-sm">
                    <Badge tone={a.severity === 'CRITICAL' ? 'danger' : 'warning'}>
                      {a.severity}
                    </Badge>{' '}
                    <Link
                      href={`/company/screens/${a.screenId}`}
                      className="text-primary hover:underline"
                    >
                      {a.name}
                    </Link>{' '}
                    <span className="text-muted-foreground">— {a.message}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {data.screens.length === 0 ? (
            <EmptyState
              title="No screens yet"
              description="Create and pair screens to monitor them here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Screen</TH>
                  <TH>Status</TH>
                  <TH>Playback</TH>
                  <TH>Sync</TH>
                  <TH>App</TH>
                  <TH>Last heartbeat</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {data.screens.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link
                        href={`/company/screens/${s.id}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      {s.locationName ? (
                        <p className="text-muted-foreground text-xs">{s.locationName}</p>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                    </TD>
                    <TD className="text-muted-foreground">{s.playbackState ?? '—'}</TD>
                    <TD className="text-muted-foreground">
                      {s.syncStatus ?? '—'}
                      {s.failedDownloads > 0 ? (
                        <span className="text-red-600"> · {s.failedDownloads} failed</span>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">{s.appVersion ?? '—'}</TD>
                    <TD className="text-muted-foreground">
                      {s.lastHeartbeatAt ? formatDateTime(s.lastHeartbeatAt, locale) : 'Never'}
                    </TD>
                    <TD>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!s.paired || busy === s.id + 'force-sync'}
                          onClick={() => action(s.id, 'force-sync', 'Force sync')}
                        >
                          Sync
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!s.paired || busy === s.id + 'take-screenshot'}
                          onClick={() => action(s.id, 'take-screenshot', 'Screenshot')}
                        >
                          Shot
                        </Button>
                      </div>
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
