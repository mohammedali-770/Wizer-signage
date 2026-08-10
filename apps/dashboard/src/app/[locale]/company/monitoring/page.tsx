'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { ExportButton } from '@/components/exports/export-button';
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
import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { LiveScreenStatus, MonitoringOverview } from '@/lib/types';
import { useApiResource } from '@/lib/use-api';

interface FleetHealthSummary {
  totalScreens: number;
  versionDistribution: Array<{ version: string; count: number }>;
  recentCrashes: Array<{
    screenId: string;
    screenName: string;
    screenStatus: string;
    appVersion: string | null;
    lastHeartbeatAt: string | null;
    crashedAtMillis: number;
    fingerprint: string;
    crashCount: number;
    reportedAt: string | null;
  }>;
}

interface PaginatedMonitoringOverview extends MonitoringOverview {
  screenMeta: { page: number; pageSize: number; total: number; totalPages: number };
  alertsTruncated: boolean;
}

const PAGE_SIZE = 50;
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
  const [page, setPage] = useState(1);
  const overview = useApiResource<PaginatedMonitoringOverview>(
    `/monitoring/overview?page=${page}&pageSize=${PAGE_SIZE}`,
    { ttl: 0 },
  );
  const fleetHealth = useApiResource<FleetHealthSummary>('/monitoring/fleet-health', { ttl: 0 });
  const [busy, setBusy] = useState<string | null>(null);

  const isArabic = locale.toLowerCase().startsWith('ar');
  const labels = isArabic
    ? {
        diagnostics: 'تشخيص أسطول التطبيق',
        diagnosticsHint: 'توزيع إصدارات المشغل وآخر حالات إعادة التشغيل بسبب الأعطال.',
        versions: 'توزيع الإصدارات',
        noVersion: 'لا توجد بيانات إصدار حتى الآن.',
        recentCrashes: 'الأعطال الأخيرة',
        noCrashes: 'لا توجد أعطال مسجلة حديثاً.',
        version: 'الإصدار',
        count: 'الشاشات',
        crashedAt: 'وقت العطل',
        crashCount: 'عدد الأعطال',
        fingerprint: 'البصمة',
        diagnosticsError: 'تعذر تحميل تشخيص إصدارات التطبيق والأعطال.',
        previous: 'السابق',
        next: 'التالي',
        page: 'الصفحة',
        of: 'من',
        showing: 'عرض',
        alertsTruncated: 'يوجد أكثر من 200 تنبيه حي. تعرض القائمة أعلى 200 تنبيه فقط.',
      }
    : {
        diagnostics: 'Player fleet diagnostics',
        diagnosticsHint: 'Player-version distribution and the latest crash-restart evidence.',
        versions: 'Version distribution',
        noVersion: 'No player version data yet.',
        recentCrashes: 'Recent crashes',
        noCrashes: 'No recent crashes have been reported.',
        version: 'Version',
        count: 'Screens',
        crashedAt: 'Crashed at',
        crashCount: 'Crash count',
        fingerprint: 'Fingerprint',
        diagnosticsError: 'Could not load player version/crash diagnostics.',
        previous: 'Previous',
        next: 'Next',
        page: 'Page',
        of: 'of',
        showing: 'Showing',
        alertsTruncated: 'More than 200 live alerts exist. The list shows the highest-priority 200.',
      };

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

  const reloadAll = () => {
    overview.reload();
    fleetHealth.reload();
  };

  const data = overview.data;

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex gap-2">
            <ExportButton dataset="screen-health" label={t('exportHealth')} />
            <Button
              variant="outline"
              onClick={reloadAll}
              disabled={overview.loading || fleetHealth.loading}
            >
              <RefreshCw className="size-4" /> {tc('refresh')}
            </Button>
          </div>
        }
      />

      {overview.loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : overview.error ? (
        <EmptyState title={t('loadError')} description={overview.error} />
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
              {data.alertsTruncated ? (
                <p className="text-muted-foreground mb-2 text-xs">{labels.alertsTruncated}</p>
              ) : null}
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

          <Card className="mb-4 p-4">
            <div className="mb-4">
              <p className="text-sm font-semibold">{labels.diagnostics}</p>
              <p className="text-muted-foreground mt-1 text-xs">{labels.diagnosticsHint}</p>
            </div>

            {fleetHealth.loading && !fleetHealth.data ? (
              <div className="flex justify-center py-6">
                <Spinner className="text-primary size-5" />
              </div>
            ) : fleetHealth.error ? (
              <p className="text-destructive text-sm">{labels.diagnosticsError}</p>
            ) : fleetHealth.data ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]">
                <div>
                  <p className="mb-2 text-sm font-medium">{labels.versions}</p>
                  {fleetHealth.data.versionDistribution.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{labels.noVersion}</p>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>{labels.version}</TH>
                          <TH className="text-end">{labels.count}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {fleetHealth.data.versionDistribution.map((entry) => (
                          <TR key={entry.version}>
                            <TD className="font-mono text-xs">{entry.version}</TD>
                            <TD className="text-end tabular-nums">{entry.count}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="mb-2 text-sm font-medium">{labels.recentCrashes}</p>
                  {fleetHealth.data.recentCrashes.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{labels.noCrashes}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <THead>
                          <TR>
                            <TH>{t('screen')}</TH>
                            <TH>{labels.version}</TH>
                            <TH>{labels.crashedAt}</TH>
                            <TH className="text-end">{labels.crashCount}</TH>
                            <TH>{labels.fingerprint}</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {fleetHealth.data.recentCrashes.map((crash) => (
                            <TR key={`${crash.screenId}-${crash.fingerprint}-${crash.crashedAtMillis}`}>
                              <TD>
                                <Link
                                  href={`/company/screens/${crash.screenId}`}
                                  className="font-medium hover:underline"
                                >
                                  {crash.screenName}
                                </Link>
                              </TD>
                              <TD className="font-mono text-xs">{crash.appVersion ?? '—'}</TD>
                              <TD className="text-muted-foreground whitespace-nowrap">
                                {formatDateTime(
                                  new Date(crash.crashedAtMillis).toISOString(),
                                  locale,
                                )}
                              </TD>
                              <TD className="text-end tabular-nums">{crash.crashCount}</TD>
                              <TD className="font-mono text-xs">{crash.fingerprint}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </Card>

          {data.screens.length === 0 ? (
            <EmptyState title={t('noScreensTitle')} description={t('noScreensDescription')} />
          ) : (
            <>
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

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  {labels.showing} {data.screens.length} / {data.screenMeta.total} · {labels.page}{' '}
                  {data.screenMeta.page} {labels.of} {Math.max(1, data.screenMeta.totalPages)}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || overview.loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {labels.previous}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= data.screenMeta.totalPages || overview.loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {labels.next}
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
