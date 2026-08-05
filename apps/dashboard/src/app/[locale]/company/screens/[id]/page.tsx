'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Pencil } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useAllPages, useApiResource } from '@/lib/use-api';
import { formatBytes, formatDateTime } from '@/lib/format';
import type {
  DeviceCommand,
  DeviceCommandStatus,
  DeviceSyncState,
  LiveScreenStatus,
  LocationListItem,
  Orientation,
  Paginated,
  PlaybackManifest,
  Screen,
  ScreenGroup,
  ScreenMonitoring,
  ScreenPairingStatus,
  ScreenUse,
  Tag,
  WorkingHours,
} from '@/lib/types';
import { useRouter, Link } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import { FallbackContentPicker } from '@/components/content/fallback-content-picker';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  Textarea,
  useToast,
} from '@/components/ui';

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const USE_OPTIONS: ScreenUse[] = [
  'MENU_LANDSCAPE',
  'OFFERS_PORTRAIT',
  'WAITING_AREA',
  'CASHIER_DISPLAY',
  'ENTRANCE',
  'INDOOR',
  'OUTDOOR',
  'GENERIC',
];

const PIN_RE = /^\d{4,8}$/;

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium">{children}</span>
    </div>
  );
}

function syncTone(status: DeviceSyncState): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'READY':
      return 'success';
    case 'SYNCING':
      return 'info';
    case 'PARTIAL':
    case 'OFFLINE_PLAYBACK':
      return 'warning';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

function liveStatusTone(
  status: LiveScreenStatus,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ONLINE':
      return 'success';
    case 'OFFLINE':
    case 'DISABLED':
      return 'danger';
    case 'WARNING':
      return 'warning';
    case 'PAIRING':
      return 'info';
    default:
      return 'neutral';
  }
}

function commandTone(
  status: DeviceCommandStatus,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'SUCCEEDED':
      return 'success';
    case 'RUNNING':
    case 'DELIVERED':
      return 'info';
    case 'PENDING':
      return 'warning';
    case 'FAILED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export default function ScreenDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('pages.screenDetail');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

  const workingHoursSummary = (wh: WorkingHours | null): string => {
    if (!wh || !wh.days || wh.days.length === 0) return t('workingHoursNotConfigured');
    const openDays = wh.days.filter((d) => !d.closed).length;
    return t('workingHoursActive', { count: openDays });
  };

  const {
    data: screen,
    loading,
    error,
    reload,
  } = useApiResource<Screen>(id ? `/screens/${id}` : null);
  const pairing = useApiResource<ScreenPairingStatus>(id ? `/screens/${id}/pairing-status` : null);
  const monitoring = useApiResource<ScreenMonitoring>(id ? `/screens/${id}/monitoring` : null);
  // Current backend manifest — to show the live manifest version/hash and whether
  // the paired device is in sync with it (Req 6).
  const manifest = useApiResource<PlaybackManifest>(id ? `/screens/${id}/playback-manifest` : null);
  const commands = useApiResource<Paginated<DeviceCommand>>(
    id ? `/screens/${id}/commands?pageSize=8` : null,
  );

  // Dialog open state.
  const [editOpen, setEditOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);

  // Dialog lookups: fetched only when the relevant dialog opens (not on page
  // load), then cached by useApiResource so reopening is instant. Avoids 3 of
  // the page's mount-time API calls for data only used inside dialogs.
  const locations = useAllPages<LocationListItem>(moveOpen ? '/locations' : null);
  const allTags = useAllPages<Tag>(tagsOpen ? '/tags' : null);
  const allGroups = useAllPages<ScreenGroup>(groupsOpen ? '/screen-groups' : null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [unpairOpen, setUnpairOpen] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [busy, setBusy] = useState(false);

  // Edit form state.
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editUse, setEditUse] = useState<'' | ScreenUse>('');
  const [editOrientation, setEditOrientation] = useState<Orientation>('LANDSCAPE');
  const [editAudioEnabled, setEditAudioEnabled] = useState(false);
  const [editVolume, setEditVolume] = useState(50);
  const [editMuted, setEditMuted] = useState(false);
  const [editKioskEnabled, setEditKioskEnabled] = useState(false);
  const [editAutoStart, setEditAutoStart] = useState(false);
  const [editNotes, setEditNotes] = useState('');
  const [editWorkingHours, setEditWorkingHours] = useState<WorkingHours | null>(null);

  // Move / tags / groups / pin form state.
  const [moveLocationId, setMoveLocationId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [pinValue, setPinValue] = useState('');

  const openEdit = () => {
    if (!screen) return;
    setEditName(screen.name);
    setEditCode(screen.code ?? '');
    setEditDescription(screen.description ?? '');
    setEditUse(screen.use ?? '');
    setEditOrientation(screen.orientation);
    setEditAudioEnabled(screen.audioEnabled);
    setEditVolume(screen.volume);
    setEditMuted(screen.muted);
    setEditKioskEnabled(screen.kioskEnabled);
    setEditAutoStart(screen.autoStartEnabled);
    setEditNotes(screen.notes ?? '');
    setEditWorkingHours(screen.workingHours);
    setEditOpen(true);
  };

  const openMove = () => {
    if (!screen) return;
    setMoveLocationId(screen.locationId ?? '');
    setMoveOpen(true);
  };

  const openTags = () => {
    if (!screen) return;
    setTagIds(screen.tags.map((t) => t.id));
    setTagsOpen(true);
  };

  const openGroups = () => {
    if (!screen) return;
    setGroupIds(screen.groups.map((g) => g.id));
    setGroupsOpen(true);
  };

  const openPin = () => {
    setPinValue('');
    setPinOpen(true);
  };

  const runAction = async (fn: () => Promise<unknown>, successMsg: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast(successMsg, 'success');
      if (after) after();
      else reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.genericError'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const monitorAction = (path: string, label: string) =>
    runAction(
      () => api.post(`/screens/${id}/actions/${path}`),
      t('toast.actionRequested', { action: label }),
      () => {
        monitoring.reload();
        commands.reload();
      },
    );

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast(t('toast.nameRequired'), 'error');
      return;
    }
    await runAction(
      () =>
        api.patch<Screen>(`/screens/${id}`, {
          name: editName.trim(),
          code: editCode.trim() || null,
          description: editDescription.trim() || null,
          use: editUse || null,
          orientation: editOrientation,
          audioEnabled: editAudioEnabled,
          volume: editVolume,
          muted: editMuted,
          kioskEnabled: editKioskEnabled,
          autoStartEnabled: editAutoStart,
          notes: editNotes.trim() || null,
          workingHours: editWorkingHours,
        }),
      t('toast.updated'),
      () => {
        setEditOpen(false);
        reload();
      },
    );
  };

  const submitMove = async () => {
    await runAction(
      () => api.post(`/screens/${id}/move`, { locationId: moveLocationId || null }),
      t('toast.moved'),
      () => {
        setMoveOpen(false);
        reload();
      },
    );
  };

  const submitTags = async () => {
    await runAction(
      () => api.put(`/screens/${id}/tags`, { tagIds }),
      t('toast.tagsUpdated'),
      () => {
        setTagsOpen(false);
        reload();
      },
    );
  };

  const submitGroups = async () => {
    await runAction(
      () => api.put(`/screens/${id}/groups`, { groupIds }),
      t('toast.groupsUpdated'),
      () => {
        setGroupsOpen(false);
        reload();
      },
    );
  };

  const submitPin = async () => {
    const pin = pinValue.trim();
    if (!PIN_RE.test(pin)) {
      toast(t('toast.pinInvalid'), 'error');
      return;
    }
    await runAction(
      () => api.put(`/screens/${id}/kiosk-pin`, { pin }),
      t('toast.pinSet'),
      () => {
        setPinOpen(false);
        reload();
      },
    );
  };

  const resetPin = async () => {
    await runAction(() => api.del(`/screens/${id}/kiosk-pin`), t('toast.pinRemoved'));
  };

  const onFallbackChange = (contentId: string | null) =>
    runAction(
      () => api.patch(`/screens/${id}`, { fallbackContentId: contentId }),
      contentId ? t('toast.fallbackUpdated') : t('toast.fallbackCleared'),
    );

  const archive = () => runAction(() => api.post(`/screens/${id}/archive`), t('toast.archived'));
  const disable = () => runAction(() => api.post(`/screens/${id}/disable`), t('toast.disabled'));
  const reactivate = () =>
    runAction(() => api.post(`/screens/${id}/reactivate`), t('toast.reactivated'));

  const submitDelete = async () => {
    await runAction(
      () => api.del(`/screens/${id}`),
      t('toast.deleted'),
      () => {
        setDeleteOpen(false);
        router.push('/company/screens');
      },
    );
  };

  const toggleId = (value: string, list: string[], setList: (next: string[]) => void) => {
    setList(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);
  };

  return (
    <div>
      <Link
        href="/company/screens"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        {t('backToScreens')}
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && screen && (
        <>
          <PageHeader
            title={screen.name}
            description={screen.code ?? undefined}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={openEdit}>
                  <Pencil className="size-4" />
                  {tc('edit')}
                </Button>
                <Button variant="outline" onClick={openMove}>
                  {t('actions.move')}
                </Button>
                <Button variant="outline" onClick={openTags}>
                  {tc('tags')}
                </Button>
                <Button variant="outline" onClick={openGroups}>
                  {t('groups')}
                </Button>
              </div>
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <StatusBadge status={screen.status} />
            {screen.status === 'ARCHIVED' || screen.status === 'DISABLED' ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={reactivate}>
                {t('actions.reactivate')}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={disable}>
                  {t('actions.disable')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={archive}>
                  {t('actions.archive')}
                </Button>
              </>
            )}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
              {tc('delete')}
            </Button>
          </div>

          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-foreground text-base font-semibold">
                {t('sections.statusControl')}
              </h2>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.devicePairing')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={tc('status')}>
                      {pairing.data?.paired ? (
                        <Badge tone="success">{t('pairing.paired')}</Badge>
                      ) : pairing.data?.pendingCollection ? (
                        <Badge tone="warning">{t('pairing.awaitingDevice')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t('pairing.notPaired')}</span>
                      )}
                    </DetailRow>
                    {pairing.data?.device ? (
                      <>
                        <DetailRow label={t('fields.device')}>
                          {pairing.data.device.modelName ??
                            pairing.data.device.platform ??
                            pairing.data.device.deviceId}
                        </DetailRow>
                        <DetailRow label={t('fields.appVersion')}>
                          {pairing.data.device.appVersion ?? '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.pairedAt')}>
                          {pairing.data.device.pairedAt
                            ? formatDateTime(pairing.data.device.pairedAt, locale)
                            : '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.lastSeen')}>
                          {pairing.data.device.lastSeenAt
                            ? formatDateTime(pairing.data.device.lastSeenAt, locale)
                            : '—'}
                        </DetailRow>
                      </>
                    ) : null}
                    <div className="flex items-center gap-2 pt-3">
                      {/* Primary CTA when the screen still needs pairing, so it
                          stands out; a re-pair on an already-paired screen is secondary. */}
                      <Button
                        size="sm"
                        variant={
                          pairing.data?.paired || pairing.data?.pendingCollection
                            ? 'outline'
                            : 'primary'
                        }
                        disabled={busy}
                        onClick={() => {
                          setPairCode('');
                          setPairOpen(true);
                        }}
                      >
                        {pairing.data?.paired || pairing.data?.pendingCollection
                          ? t('actions.rePair')
                          : t('actions.pairDevice')}
                      </Button>
                      {(pairing.data?.paired || pairing.data?.pendingCollection) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setUnpairOpen(true)}
                        >
                          {t('actions.unpair')}
                        </Button>
                      )}
                    </div>
                    <p className="text-muted-foreground pt-3 text-xs">{t('pairing.hint')}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.syncCache')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    {pairing.data?.sync ? (
                      <>
                        <DetailRow label={t('fields.syncStatus')}>
                          <Badge tone={syncTone(pairing.data.sync.status)}>
                            {pairing.data.sync.status}
                          </Badge>
                        </DetailRow>
                        <DetailRow label={t('fields.playingFrom')}>
                          {pairing.data.sync.manifestSource === 'LOCAL_CACHE' ? (
                            <Badge tone="warning">{t('sync.offlineCache')}</Badge>
                          ) : pairing.data.sync.manifestSource === 'REMOTE' ? (
                            <Badge tone="success">{t('sync.online')}</Badge>
                          ) : (
                            '—'
                          )}
                        </DetailRow>
                        <DetailRow label={t('fields.assetsCached')}>
                          {pairing.data.sync.cachedAssets ?? 0} /{' '}
                          {pairing.data.sync.requiredAssets ?? 0}
                        </DetailRow>
                        <DetailRow label={t('fields.failedDownloads')}>
                          {pairing.data.sync.failedDownloads ?? 0}
                        </DetailRow>
                        <DetailRow label={t('fields.cacheSize')}>
                          {pairing.data.sync.cacheSizeBytes
                            ? formatBytes(Number(pairing.data.sync.cacheSizeBytes), locale)
                            : '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.freeStorage')}>
                          {pairing.data.sync.availableStorageBytes
                            ? formatBytes(Number(pairing.data.sync.availableStorageBytes), locale)
                            : '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.lastSync')}>
                          {pairing.data.sync.lastSyncAt
                            ? formatDateTime(pairing.data.sync.lastSyncAt, locale)
                            : '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.currentManifest')}>
                          {manifest.data?.manifestHash ? (
                            <span className="font-mono text-xs">
                              {manifest.data.manifestHash.slice(0, 12)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </DetailRow>
                        <DetailRow label={t('fields.deviceSyncedTo')}>
                          {(() => {
                            // Defensive: TS narrowing from the outer `sync` guard does
                            // not flow into this closure.
                            const reported = pairing.data?.sync?.manifestVersion;
                            if (!reported) return '—';
                            const isHash = /^[0-9a-f]{64}$/.test(reported);
                            const current = manifest.data?.manifestHash ?? null;
                            return (
                              <span className="flex items-center justify-end gap-2">
                                <span className="font-mono text-xs">{reported.slice(0, 12)}</span>
                                {isHash && current ? (
                                  reported === current ? (
                                    <Badge tone="success">{t('sync.inSync')}</Badge>
                                  ) : (
                                    <Badge tone="warning">{t('sync.updatePending')}</Badge>
                                  )
                                ) : null}
                              </span>
                            );
                          })()}
                        </DetailRow>
                        {pairing.data.sync.lastError ? (
                          <DetailRow label={t('fields.lastError')}>
                            <span className="text-red-600 dark:text-red-400">
                              {pairing.data.sync.lastError}
                            </span>
                          </DetailRow>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-muted-foreground py-2 text-sm">{t('sync.noData')}</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.monitoring')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={tc('status')}>
                      <StatusBadge status={screen.status} />
                    </DetailRow>
                    <DetailRow label={t('fields.lastHeartbeat')}>
                      {screen.lastHeartbeatAt
                        ? formatDateTime(screen.lastHeartbeatAt, locale)
                        : t('never')}
                    </DetailRow>
                    <DetailRow label={t('fields.lastSync')}>
                      {screen.lastSyncAt ? formatDateTime(screen.lastSyncAt, locale) : t('never')}
                    </DetailRow>
                    <DetailRow label={t('fields.appVersion')}>{screen.appVersion ?? '—'}</DetailRow>
                    <DetailRow label={t('fields.currentContent')}>
                      {screen.currentContentId ?? '—'}
                    </DetailRow>
                    <DetailRow label={t('fields.storageUsed')}>
                      {screen.storageUsedBytes
                        ? formatBytes(Number(screen.storageUsedBytes), locale)
                        : '—'}
                    </DetailRow>
                    <p className="text-muted-foreground pt-3 text-xs">{t('monitoringHint')}</p>
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader className="flex items-center justify-between">
                    <CardTitle>{t('cards.monitoringControl')}</CardTitle>
                    {monitoring.data ? (
                      <Badge tone={liveStatusTone(monitoring.data.status)}>
                        {monitoring.data.status}
                      </Badge>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="divide-border divide-y">
                        <DetailRow label={t('fields.playback')}>
                          {monitoring.data?.telemetry?.playbackState ?? '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.network')}>
                          {monitoring.data?.telemetry?.networkStatus ?? '—'}
                        </DetailRow>
                        <DetailRow label={t('fields.lastHeartbeat')}>
                          {monitoring.data?.lastHeartbeatAt
                            ? formatDateTime(monitoring.data.lastHeartbeatAt, locale)
                            : t('never')}
                        </DetailRow>
                        <DetailRow label={t('fields.device')}>
                          {monitoring.data?.telemetry?.deviceModel ?? '—'}
                          {monitoring.data?.telemetry?.osVersion
                            ? ` · ${monitoring.data.telemetry.osVersion}`
                            : ''}
                        </DetailRow>
                        <DetailRow label={t('fields.appVersion')}>
                          {monitoring.data?.telemetry?.appVersion ?? '—'}
                        </DetailRow>
                        {monitoring.data?.warningReason ? (
                          <DetailRow label={t('fields.warning')}>
                            <span className="text-amber-600 dark:text-amber-400">
                              {monitoring.data.warningReason}
                            </span>
                          </DetailRow>
                        ) : null}
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-1 text-xs">
                          {t('latestScreenshot')}
                        </p>
                        {monitoring.data?.latestScreenshot?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={monitoring.data.latestScreenshot.url}
                            alt={t('latestScreenshot')}
                            className="border-border max-h-48 w-full rounded-md border object-contain"
                          />
                        ) : (
                          <div className="border-border text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
                            {t('noScreenshot')}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="border-border flex flex-wrap gap-2 border-t pt-3">
                      {/* Primary action — pushes a force-sync so the screen re-fetches
                          and re-downloads immediately (Req 4). */}
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => monitorAction('force-sync', t('actions.forceSync'))}
                      >
                        {t('actions.forceSync')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          monitorAction('refresh-manifest', t('actions.refreshManifest'))
                        }
                      >
                        {t('actions.refreshManifest')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          monitorAction('restart-playback', t('actions.restartPlayback'))
                        }
                      >
                        {t('actions.restartPlayback')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => monitorAction('clear-cache', t('actions.clearCache'))}
                      >
                        {t('actions.clearCache')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          monitorAction('take-screenshot', t('actions.takeScreenshot'))
                        }
                      >
                        {t('actions.takeScreenshot')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => monitorAction('reboot', t('actions.reboot'))}
                      >
                        {t('actions.reboot')}
                      </Button>
                    </div>

                    {commands.data && commands.data.items.length > 0 ? (
                      <div className="border-border border-t pt-3">
                        <p className="text-muted-foreground mb-2 text-xs">{t('recentCommands')}</p>
                        <ul className="space-y-1">
                          {commands.data.items.map((c) => (
                            <li
                              key={c.id}
                              className="flex items-center justify-between gap-2 text-sm"
                            >
                              <span>{c.commandType}</span>
                              <span className="text-muted-foreground flex items-center gap-2">
                                <Badge tone={commandTone(c.status)}>{c.status}</Badge>
                                {formatDateTime(c.createdAt, locale)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-foreground text-base font-semibold">
                {t('sections.configuration')}
              </h2>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.identity')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={tc('location')}>
                      {screen.location?.name ?? t('unassigned')}
                    </DetailRow>
                    <DetailRow label={t('fields.use')}>
                      {screen.use ? te(`screenUse.${screen.use}`) : '—'}
                    </DetailRow>
                    <DetailRow label={tc('orientation')}>
                      {te(`orientation.${screen.orientation}`)}
                    </DetailRow>
                    <DetailRow label={tc('description')}>{screen.description || '—'}</DetailRow>
                    <DetailRow label={t('fields.notes')}>{screen.notes || '—'}</DetailRow>
                    <DetailRow label={tc('created')}>
                      {formatDateTime(screen.createdAt, locale)}
                    </DetailRow>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.audio')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={t('fields.audioEnabled')}>
                      {screen.audioEnabled ? t('yes') : t('no')}
                    </DetailRow>
                    <DetailRow label={t('fields.volume')}>{screen.volume}</DetailRow>
                    <DetailRow label={t('fields.muted')}>
                      {screen.muted ? t('yes') : t('no')}
                    </DetailRow>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.kiosk')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={t('fields.kioskMode')}>
                      {screen.kioskEnabled ? t('enabled') : t('disabled')}
                    </DetailRow>
                    <DetailRow label={t('fields.kioskPin')}>
                      {screen.hasKioskPin ? (
                        <Badge tone="success">{t('pinSet')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">{t('notSet')}</span>
                      )}
                    </DetailRow>
                    <DetailRow label={t('fields.autoStart')}>
                      {screen.autoStartEnabled ? t('yes') : t('no')}
                    </DetailRow>
                    <div className="flex items-center gap-2 pt-3">
                      <Button size="sm" variant="outline" disabled={busy} onClick={openPin}>
                        {screen.hasKioskPin ? t('actions.changePin') : t('actions.setPin')}
                      </Button>
                      {screen.hasKioskPin && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={resetPin}>
                          {t('actions.removePin')}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.workingHours')}</CardTitle>
                  </CardHeader>
                  <CardContent className="divide-border divide-y">
                    <DetailRow label={t('fields.schedule')}>
                      {workingHoursSummary(screen.workingHours)}
                    </DetailRow>
                    <DetailRow label={t('fields.timezone')}>
                      {screen.workingHours?.timezone || '—'}
                    </DetailRow>
                    <DetailRow label={t('fields.outsideHours')}>
                      {screen.workingHours?.outsideHoursBehavior || '—'}
                    </DetailRow>
                  </CardContent>
                </Card>
              </div>
            </section>
            <section className="space-y-3">
              <h2 className="text-foreground text-base font-semibold">{t('sections.targeting')}</h2>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.tagsGroups')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-muted-foreground mb-2 text-sm">{tc('tags')}</p>
                      {screen.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {screen.tags.map((tag) => (
                            <Badge key={tag.id} tone="info">
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm">{t('none')}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-2 text-sm">{t('groups')}</p>
                      {screen.groups.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {screen.groups.map((g) => (
                            <Badge key={g.id}>{g.name}</Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm">{t('none')}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('cards.fallbackContent')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-muted-foreground text-sm">{t('fallbackHint')}</p>
                    <FallbackContentPicker
                      value={screen.fallbackContentId}
                      onChange={onFallbackChange}
                      orientation={screen.orientation}
                      busy={busy}
                    />
                  </CardContent>
                </Card>
              </div>
            </section>
          </div>

          {/* Edit dialog */}
          <Dialog
            open={editOpen}
            onClose={() => !busy && setEditOpen(false)}
            title={t('editDialog.title')}
            description={t('editDialog.description')}
            className="max-h-[90vh] max-w-2xl overflow-y-auto"
          >
            <form onSubmit={submitEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={tc('name')}>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                </Field>
                <Field label={t('fields.code')}>
                  <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                </Field>
              </div>

              <Field label={tc('description')}>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t('fields.use')}>
                  <Select
                    value={editUse}
                    onChange={(e) => setEditUse(e.target.value as '' | ScreenUse)}
                  >
                    <option value="">{t('notSet')}</option>
                    {USE_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {te(`screenUse.${u}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={tc('orientation')}>
                  <Select
                    value={editOrientation}
                    onChange={(e) => setEditOrientation(e.target.value as Orientation)}
                  >
                    {ORIENTATION_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {te(`orientation.${o}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="border-border rounded-lg border p-4">
                <p className="mb-3 text-sm font-medium">{t('cards.audio')}</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      id="edit-audio"
                      type="checkbox"
                      className="border-border accent-primary size-4 rounded"
                      checked={editAudioEnabled}
                      onChange={(e) => setEditAudioEnabled(e.target.checked)}
                    />
                    <Label htmlFor="edit-audio" className="mb-0">
                      {t('fields.audioEnabled')}
                    </Label>
                  </div>
                  <div>
                    <Label htmlFor="edit-volume">
                      {t('fields.volume')} ({editVolume})
                    </Label>
                    <input
                      id="edit-volume"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={editVolume}
                      disabled={!editAudioEnabled}
                      onChange={(e) => setEditVolume(Number(e.target.value))}
                      className="accent-primary w-full disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="edit-muted"
                      type="checkbox"
                      className="border-border accent-primary size-4 rounded"
                      checked={editMuted}
                      onChange={(e) => setEditMuted(e.target.checked)}
                    />
                    <Label htmlFor="edit-muted" className="mb-0">
                      {t('fields.muted')}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <div className="flex items-center gap-2">
                  <input
                    id="edit-kiosk"
                    type="checkbox"
                    className="border-border accent-primary size-4 rounded"
                    checked={editKioskEnabled}
                    onChange={(e) => setEditKioskEnabled(e.target.checked)}
                  />
                  <Label htmlFor="edit-kiosk" className="mb-0">
                    {t('fields.kioskModeEnabled')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="edit-autostart"
                    type="checkbox"
                    className="border-border accent-primary size-4 rounded"
                    checked={editAutoStart}
                    onChange={(e) => setEditAutoStart(e.target.checked)}
                  />
                  <Label htmlFor="edit-autostart" className="mb-0">
                    {t('fields.autoStartOnBoot')}
                  </Label>
                </div>
              </div>

              <Field label={t('fields.notes')}>
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="border-border rounded-lg border p-4">
                <p className="mb-3 text-sm font-medium">{t('cards.workingHours')}</p>
                <WorkingHoursEditor value={editWorkingHours} onChange={setEditWorkingHours} />
              </div>

              <div className="border-border flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  {t('editDialog.submit')}
                </Button>
              </div>
            </form>
          </Dialog>

          {/* Move dialog */}
          <Dialog
            open={moveOpen}
            onClose={() => !busy && setMoveOpen(false)}
            title={t('moveDialog.title')}
            description={t('moveDialog.description')}
          >
            <div className="space-y-4">
              <Field label={tc('location')}>
                <Select value={moveLocationId} onChange={(e) => setMoveLocationId(e.target.value)}>
                  <option value="">{t('unassigned')}</option>
                  {(locations.data?.items ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMoveOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button type="button" onClick={submitMove} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  {t('actions.move')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Tags dialog */}
          <Dialog
            open={tagsOpen}
            onClose={() => !busy && setTagsOpen(false)}
            title={t('tagsDialog.title')}
            description={t('tagsDialog.description')}
            className="max-h-[80vh] overflow-y-auto"
          >
            <div className="space-y-4">
              {(allTags.data?.items ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('tagsDialog.empty')}</p>
              ) : (
                <div className="space-y-2">
                  {(allTags.data?.items ?? []).map((tag) => (
                    <label key={tag.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="border-border accent-primary size-4 rounded"
                        checked={tagIds.includes(tag.id)}
                        onChange={() => toggleId(tag.id, tagIds, setTagIds)}
                      />
                      {tag.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="border-border flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTagsOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button type="button" onClick={submitTags} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  {t('tagsDialog.submit')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Groups dialog */}
          <Dialog
            open={groupsOpen}
            onClose={() => !busy && setGroupsOpen(false)}
            title={t('groupsDialog.title')}
            description={t('groupsDialog.description')}
            className="max-h-[80vh] overflow-y-auto"
          >
            <div className="space-y-4">
              {(allGroups.data?.items ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('groupsDialog.empty')}</p>
              ) : (
                <div className="space-y-2">
                  {(allGroups.data?.items ?? []).map((g) => (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="border-border accent-primary size-4 rounded"
                        checked={groupIds.includes(g.id)}
                        onChange={() => toggleId(g.id, groupIds, setGroupIds)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="border-border flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setGroupsOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button type="button" onClick={submitGroups} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  {t('groupsDialog.submit')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Kiosk PIN dialog */}
          <Dialog
            open={pinOpen}
            onClose={() => !busy && setPinOpen(false)}
            title={screen.hasKioskPin ? t('pinDialog.titleChange') : t('pinDialog.titleSet')}
            description={t('pinDialog.description')}
          >
            <div className="space-y-4">
              <Field label={t('fields.kioskPin')}>
                <Input
                  type="password"
                  autoComplete="off"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder={t('pinDialog.placeholder')}
                  inputMode="numeric"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPinOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button type="button" onClick={submitPin} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  {t('pinDialog.submit')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Pair device */}
          <Dialog
            open={pairOpen}
            onClose={() => !busy && setPairOpen(false)}
            title={t('pairDialog.title')}
            description={t('pairDialog.description')}
          >
            <div className="space-y-4">
              <Field label={t('fields.pairingCode')}>
                <Input
                  value={pairCode}
                  onChange={(e) =>
                    setPairCode(
                      e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g, '')
                        .slice(0, 8),
                    )
                  }
                  placeholder={t('pairDialog.placeholder')}
                  autoFocus
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPairOpen(false)}
                  disabled={busy}
                >
                  {tc('cancel')}
                </Button>
                <Button
                  type="button"
                  disabled={busy || pairCode.trim().length < 4}
                  onClick={() =>
                    runAction(
                      () => api.post(`/screens/${id}/pair`, { pairingCode: pairCode.trim() }),
                      t('toast.devicePaired'),
                      () => {
                        setPairOpen(false);
                        reload();
                        pairing.reload();
                      },
                    )
                  }
                >
                  {busy && <Spinner className="size-4" />}
                  {t('pairDialog.submit')}
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Unpair confirmation */}
          <Dialog
            open={unpairOpen}
            onClose={() => !busy && setUnpairOpen(false)}
            title={t('unpairDialog.title')}
            description={t('unpairDialog.description')}
          >
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnpairOpen(false)}
                disabled={busy}
              >
                {tc('cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => api.post(`/screens/${id}/unpair`),
                    t('toast.deviceUnpaired'),
                    () => {
                      setUnpairOpen(false);
                      reload();
                      pairing.reload();
                    },
                  )
                }
              >
                {busy && <Spinner className="size-4" />}
                {t('actions.unpair')}
              </Button>
            </div>
          </Dialog>

          {/* Delete confirmation */}
          <Dialog
            open={deleteOpen}
            onClose={() => !busy && setDeleteOpen(false)}
            title={t('deleteDialog.title')}
            description={t('deleteDialog.description')}
          >
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={busy}
              >
                {tc('cancel')}
              </Button>
              <Button type="button" variant="danger" onClick={submitDelete} disabled={busy}>
                {busy && <Spinner className="size-4" />}
                {t('deleteDialog.submit')}
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
