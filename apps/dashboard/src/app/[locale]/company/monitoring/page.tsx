'use client';

import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.monitoring');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();
  const { data, loading, error, reload } =
    useApiResource<MonitoringOverview>('/monitoring/overview');
  const [busy, setBusy] = useState<string | null>(null);

  const action = async (screenId: string, path: string, label: string) => {
    setBusy(screenId + path);
    try {
      await api.post(`/screens/${screenId}/actions/${path}`);
      toast(t('actionRequested', { label }), 'success');
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
        actions={
          <div className="flex gap-2">
            <ExportButton dataset="screen-health" label={t('exportHealth')} />
            <Button variant="outline" onClick={reload} disabled={loading}>
              <RefreshCw className="size-4" /> {tc('refresh')}
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data ? null : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label={t('screens')} value={data.totals.total} />
            <StatCard label={te('screenStatus.ONLINE')} value={data.totals.online} />
            <StatCard
              label={te('screenStatus.OFFLINE')}
              value={data.totals.offline}
              hint={t('missingHeartbeat', { count: data.missingHeartbeat })}
            />
            <StatCard label={te('screenStatus.WARNING')} value={data.totals.warning} />
            <StatCard label={te('screenStatus.UNPAIRED')} value={data.totals.unpaired} />
            <StatCard label={t('failedSync')} value={data.withFailedDownloads} />
          </div>

          {data.alerts.length > 0 ? (
            <Card className="mb-4 p-4">
              <p className="mb-2 text-sm font-semibold">{t('alerts')}</p>
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
            <EmptyState title={t('noScreensTitle')} description={t('noScreensDescription')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('screen')}</TH>
                  <TH>{tc('status')}</TH>
                  <TH>{t('playback')}</TH>
                  <TH>{t('sync')}</TH>
                  <TH>{t('app')}</TH>
                  <TH>{t('lastHeartbeat')}</TH>
                  <TH>{tc('actions')}</TH>
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
                        <span className="text-red-600">
                          {' '}
                          · {t('failedCount', { count: s.failedDownloads })}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-muted-foreground">{s.appVersion ?? '—'}</TD>
                    <TD className="text-muted-foreground">
                      {s.lastHeartbeatAt ? formatDateTime(s.lastHeartbeatAt, locale) : t('never')}
                    </TD>
                    <TD>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!s.paired || busy === s.id + 'force-sync'}
                          onClick={() => action(s.id, 'force-sync', t('forceSync'))}
                        >
                          {t('syncAction')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!s.paired || busy === s.id + 'take-screenshot'}
                          onClick={() => action(s.id, 'take-screenshot', t('screenshot'))}
                        >
                          {t('shotAction')}
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
