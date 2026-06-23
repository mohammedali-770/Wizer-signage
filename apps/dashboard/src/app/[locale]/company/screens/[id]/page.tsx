'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { ArrowLeft, Pencil } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
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

const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: 'LANDSCAPE', label: 'Landscape' },
  { value: 'PORTRAIT', label: 'Portrait' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

const USE_OPTIONS: { value: ScreenUse; label: string }[] = [
  { value: 'MENU_LANDSCAPE', label: 'Menu (Landscape)' },
  { value: 'OFFERS_PORTRAIT', label: 'Offers (Portrait)' },
  { value: 'WAITING_AREA', label: 'Waiting Area' },
  { value: 'CASHIER_DISPLAY', label: 'Cashier Display' },
  { value: 'ENTRANCE', label: 'Entrance' },
  { value: 'INDOOR', label: 'Indoor' },
  { value: 'OUTDOOR', label: 'Outdoor' },
  { value: 'GENERIC', label: 'Generic/Custom' },
];

const USE_LABELS: Record<ScreenUse, string> = {
  MENU_LANDSCAPE: 'Menu (Landscape)',
  OFFERS_PORTRAIT: 'Offers (Portrait)',
  WAITING_AREA: 'Waiting Area',
  CASHIER_DISPLAY: 'Cashier Display',
  ENTRANCE: 'Entrance',
  INDOOR: 'Indoor',
  OUTDOOR: 'Outdoor',
  GENERIC: 'Generic/Custom',
};

const ORIENTATION_LABELS: Record<Orientation, string> = {
  LANDSCAPE: 'Landscape',
  PORTRAIT: 'Portrait',
  UNKNOWN: 'Unknown',
};

const PIN_RE = /^\d{4,8}$/;

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
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

function workingHoursSummary(wh: WorkingHours | null): string {
  if (!wh || !wh.days || wh.days.length === 0) return 'Not configured';
  const openDays = wh.days.filter((d) => !d.closed).length;
  return `${openDays} day${openDays === 1 ? '' : 's'} active`;
}

export default function ScreenDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();

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
  const locations = useApiResource<Paginated<LocationListItem>>(
    moveOpen ? '/locations?pageSize=100' : null,
  );
  const allTags = useApiResource<Paginated<Tag>>(tagsOpen ? '/tags?pageSize=100' : null);
  const allGroups = useApiResource<Paginated<ScreenGroup>>(
    groupsOpen ? '/screen-groups?pageSize=100' : null,
  );
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
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const monitorAction = (path: string, label: string) =>
    runAction(
      () => api.post(`/screens/${id}/actions/${path}`),
      `${label} requested.`,
      () => {
        monitoring.reload();
        commands.reload();
      },
    );

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast('Name is required.', 'error');
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
      'Screen updated.',
      () => {
        setEditOpen(false);
        reload();
      },
    );
  };

  const submitMove = async () => {
    await runAction(
      () => api.post(`/screens/${id}/move`, { locationId: moveLocationId || null }),
      'Screen moved.',
      () => {
        setMoveOpen(false);
        reload();
      },
    );
  };

  const submitTags = async () => {
    await runAction(
      () => api.put(`/screens/${id}/tags`, { tagIds }),
      'Tags updated.',
      () => {
        setTagsOpen(false);
        reload();
      },
    );
  };

  const submitGroups = async () => {
    await runAction(
      () => api.put(`/screens/${id}/groups`, { groupIds }),
      'Groups updated.',
      () => {
        setGroupsOpen(false);
        reload();
      },
    );
  };

  const submitPin = async () => {
    const pin = pinValue.trim();
    if (!PIN_RE.test(pin)) {
      toast('Kiosk PIN must be 4-8 digits.', 'error');
      return;
    }
    await runAction(
      () => api.put(`/screens/${id}/kiosk-pin`, { pin }),
      'Kiosk PIN set.',
      () => {
        setPinOpen(false);
        reload();
      },
    );
  };

  const resetPin = async () => {
    await runAction(() => api.del(`/screens/${id}/kiosk-pin`), 'Kiosk PIN removed.');
  };

  const onFallbackChange = (contentId: string | null) =>
    runAction(
      () => api.patch(`/screens/${id}`, { fallbackContentId: contentId }),
      contentId ? 'Fallback content updated.' : 'Fallback content cleared.',
    );

  const archive = () => runAction(() => api.post(`/screens/${id}/archive`), 'Screen archived.');
  const disable = () => runAction(() => api.post(`/screens/${id}/disable`), 'Screen disabled.');
  const reactivate = () =>
    runAction(() => api.post(`/screens/${id}/reactivate`), 'Screen reactivated.');

  const submitDelete = async () => {
    await runAction(
      () => api.del(`/screens/${id}`),
      'Screen deleted.',
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
        Back to screens
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load screen" description={error} />}

      {!loading && !error && screen && (
        <>
          <PageHeader
            title={screen.name}
            description={screen.code ?? undefined}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={openEdit}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                <Button variant="outline" onClick={openMove}>
                  Move
                </Button>
                <Button variant="outline" onClick={openTags}>
                  Tags
                </Button>
                <Button variant="outline" onClick={openGroups}>
                  Groups
                </Button>
              </div>
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <StatusBadge status={screen.status} />
            {screen.status === 'ARCHIVED' || screen.status === 'DISABLED' ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={reactivate}>
                Reactivate
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" disabled={busy} onClick={disable}>
                  Disable
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={archive}>
                  Archive
                </Button>
              </>
            )}
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Identity</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Location">{screen.location?.name ?? 'Unassigned'}</DetailRow>
                <DetailRow label="Use">{screen.use ? USE_LABELS[screen.use] : '—'}</DetailRow>
                <DetailRow label="Orientation">{ORIENTATION_LABELS[screen.orientation]}</DetailRow>
                <DetailRow label="Description">{screen.description || '—'}</DetailRow>
                <DetailRow label="Notes">{screen.notes || '—'}</DetailRow>
                <DetailRow label="Created">{formatDateTime(screen.createdAt, locale)}</DetailRow>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Monitoring</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Status">
                  <StatusBadge status={screen.status} />
                </DetailRow>
                <DetailRow label="Last heartbeat">
                  {screen.lastHeartbeatAt
                    ? formatDateTime(screen.lastHeartbeatAt, locale)
                    : 'Never'}
                </DetailRow>
                <DetailRow label="Last sync">
                  {screen.lastSyncAt ? formatDateTime(screen.lastSyncAt, locale) : 'Never'}
                </DetailRow>
                <DetailRow label="App version">{screen.appVersion ?? '—'}</DetailRow>
                <DetailRow label="Current content">{screen.currentContentId ?? '—'}</DetailRow>
                <DetailRow label="Storage used">
                  {screen.storageUsedBytes
                    ? formatBytes(Number(screen.storageUsedBytes), locale)
                    : '—'}
                </DetailRow>
                <p className="text-muted-foreground pt-3 text-xs">
                  Monitoring values populate when the player connects (later phase).
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Audio</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Audio enabled">{screen.audioEnabled ? 'Yes' : 'No'}</DetailRow>
                <DetailRow label="Volume">{screen.volume}</DetailRow>
                <DetailRow label="Muted">{screen.muted ? 'Yes' : 'No'}</DetailRow>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Kiosk &amp; startup</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Kiosk mode">
                  {screen.kioskEnabled ? 'Enabled' : 'Disabled'}
                </DetailRow>
                <DetailRow label="Kiosk PIN">
                  {screen.hasKioskPin ? (
                    <Badge tone="success">PIN set</Badge>
                  ) : (
                    <span className="text-muted-foreground">Not set</span>
                  )}
                </DetailRow>
                <DetailRow label="Auto-start">{screen.autoStartEnabled ? 'Yes' : 'No'}</DetailRow>
                <div className="flex items-center gap-2 pt-3">
                  <Button size="sm" variant="outline" disabled={busy} onClick={openPin}>
                    {screen.hasKioskPin ? 'Change PIN' : 'Set PIN'}
                  </Button>
                  {screen.hasKioskPin && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={resetPin}>
                      Remove PIN
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Device pairing</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Status">
                  {pairing.data?.paired ? (
                    <Badge tone="success">Paired</Badge>
                  ) : pairing.data?.pendingCollection ? (
                    <Badge tone="warning">Awaiting device</Badge>
                  ) : (
                    <span className="text-muted-foreground">Not paired</span>
                  )}
                </DetailRow>
                {pairing.data?.device ? (
                  <>
                    <DetailRow label="Device">
                      {pairing.data.device.modelName ??
                        pairing.data.device.platform ??
                        pairing.data.device.deviceId}
                    </DetailRow>
                    <DetailRow label="App version">
                      {pairing.data.device.appVersion ?? '—'}
                    </DetailRow>
                    <DetailRow label="Paired at">
                      {pairing.data.device.pairedAt
                        ? formatDateTime(pairing.data.device.pairedAt, locale)
                        : '—'}
                    </DetailRow>
                    <DetailRow label="Last seen">
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
                      ? 'Re-pair'
                      : 'Pair device'}
                  </Button>
                  {(pairing.data?.paired || pairing.data?.pendingCollection) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setUnpairOpen(true)}
                    >
                      Unpair
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground pt-3 text-xs">
                  Open MasterSignage on the TV, then enter the code it shows here to pair.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sync &amp; cache</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                {pairing.data?.sync ? (
                  <>
                    <DetailRow label="Sync status">
                      <Badge tone={syncTone(pairing.data.sync.status)}>
                        {pairing.data.sync.status}
                      </Badge>
                    </DetailRow>
                    <DetailRow label="Playing from">
                      {pairing.data.sync.manifestSource === 'LOCAL_CACHE' ? (
                        <Badge tone="warning">Offline cache</Badge>
                      ) : pairing.data.sync.manifestSource === 'REMOTE' ? (
                        <Badge tone="success">Online</Badge>
                      ) : (
                        '—'
                      )}
                    </DetailRow>
                    <DetailRow label="Assets cached">
                      {pairing.data.sync.cachedAssets ?? 0} /{' '}
                      {pairing.data.sync.requiredAssets ?? 0}
                    </DetailRow>
                    <DetailRow label="Failed downloads">
                      {pairing.data.sync.failedDownloads ?? 0}
                    </DetailRow>
                    <DetailRow label="Cache size">
                      {pairing.data.sync.cacheSizeBytes
                        ? formatBytes(Number(pairing.data.sync.cacheSizeBytes), locale)
                        : '—'}
                    </DetailRow>
                    <DetailRow label="Free storage">
                      {pairing.data.sync.availableStorageBytes
                        ? formatBytes(Number(pairing.data.sync.availableStorageBytes), locale)
                        : '—'}
                    </DetailRow>
                    <DetailRow label="Last sync">
                      {pairing.data.sync.lastSyncAt
                        ? formatDateTime(pairing.data.sync.lastSyncAt, locale)
                        : '—'}
                    </DetailRow>
                    <DetailRow label="Current manifest">
                      {manifest.data?.manifestHash ? (
                        <span className="font-mono text-xs">
                          {manifest.data.manifestHash.slice(0, 12)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </DetailRow>
                    <DetailRow label="Device synced to">
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
                                <Badge tone="success">In sync</Badge>
                              ) : (
                                <Badge tone="warning">Update pending</Badge>
                              )
                            ) : null}
                          </span>
                        );
                      })()}
                    </DetailRow>
                    {pairing.data.sync.lastError ? (
                      <DetailRow label="Last error">
                        <span className="text-red-600 dark:text-red-400">
                          {pairing.data.sync.lastError}
                        </span>
                      </DetailRow>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground py-2 text-sm">No sync data reported yet.</p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>Monitoring &amp; control</CardTitle>
                {monitoring.data ? (
                  <Badge tone={liveStatusTone(monitoring.data.status)}>
                    {monitoring.data.status}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="divide-border divide-y">
                    <DetailRow label="Playback">
                      {monitoring.data?.telemetry?.playbackState ?? '—'}
                    </DetailRow>
                    <DetailRow label="Network">
                      {monitoring.data?.telemetry?.networkStatus ?? '—'}
                    </DetailRow>
                    <DetailRow label="Last heartbeat">
                      {monitoring.data?.lastHeartbeatAt
                        ? formatDateTime(monitoring.data.lastHeartbeatAt, locale)
                        : 'Never'}
                    </DetailRow>
                    <DetailRow label="Device">
                      {monitoring.data?.telemetry?.deviceModel ?? '—'}
                      {monitoring.data?.telemetry?.osVersion
                        ? ` · ${monitoring.data.telemetry.osVersion}`
                        : ''}
                    </DetailRow>
                    <DetailRow label="App version">
                      {monitoring.data?.telemetry?.appVersion ?? '—'}
                    </DetailRow>
                    {monitoring.data?.warningReason ? (
                      <DetailRow label="Warning">
                        <span className="text-amber-600 dark:text-amber-400">
                          {monitoring.data.warningReason}
                        </span>
                      </DetailRow>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-muted-foreground mb-1 text-xs">Latest screenshot</p>
                    {monitoring.data?.latestScreenshot?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={monitoring.data.latestScreenshot.url}
                        alt="Latest screenshot"
                        className="border-border max-h-48 w-full rounded-md border object-contain"
                      />
                    ) : (
                      <div className="border-border text-muted-foreground flex h-32 items-center justify-center rounded-md border border-dashed text-sm">
                        No screenshot yet
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
                    onClick={() => monitorAction('force-sync', 'Force sync')}
                  >
                    Force sync
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => monitorAction('refresh-manifest', 'Refresh manifest')}
                  >
                    Refresh manifest
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => monitorAction('restart-playback', 'Restart playback')}
                  >
                    Restart playback
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => monitorAction('clear-cache', 'Clear cache')}
                  >
                    Clear cache
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => monitorAction('take-screenshot', 'Screenshot')}
                  >
                    Take screenshot
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => monitorAction('reboot', 'Reboot')}
                  >
                    Reboot
                  </Button>
                </div>

                {commands.data && commands.data.items.length > 0 ? (
                  <div className="border-border border-t pt-3">
                    <p className="text-muted-foreground mb-2 text-xs">Recent commands</p>
                    <ul className="space-y-1">
                      {commands.data.items.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
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

            <Card>
              <CardHeader>
                <CardTitle>Working hours</CardTitle>
              </CardHeader>
              <CardContent className="divide-border divide-y">
                <DetailRow label="Schedule">{workingHoursSummary(screen.workingHours)}</DetailRow>
                <DetailRow label="Timezone">{screen.workingHours?.timezone || '—'}</DetailRow>
                <DetailRow label="Outside hours">
                  {screen.workingHours?.outsideHoursBehavior || '—'}
                </DetailRow>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tags &amp; groups</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-muted-foreground mb-2 text-sm">Tags</p>
                  {screen.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {screen.tags.map((t) => (
                        <Badge key={t.id} tone="info">
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm">None</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground mb-2 text-sm">Groups</p>
                  {screen.groups.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {screen.groups.map((g) => (
                        <Badge key={g.id}>{g.name}</Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm">None</p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fallback content</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  Shown on this screen when no playlist or schedule is active. Overrides the
                  location and company defaults. Only ACTIVE content can be chosen; a warning
                  appears if the content orientation does not match this screen.
                </p>
                <FallbackContentPicker
                  value={screen.fallbackContentId}
                  onChange={onFallbackChange}
                  orientation={screen.orientation}
                  busy={busy}
                />
              </CardContent>
            </Card>
          </div>

          {/* Edit dialog */}
          <Dialog
            open={editOpen}
            onClose={() => !busy && setEditOpen(false)}
            title="Edit Screen"
            description="Update screen settings and configuration."
            className="max-h-[90vh] max-w-2xl overflow-y-auto"
          >
            <form onSubmit={submitEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
                </Field>
                <Field label="Code">
                  <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                </Field>
              </div>

              <Field label="Description">
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Use">
                  <Select
                    value={editUse}
                    onChange={(e) => setEditUse(e.target.value as '' | ScreenUse)}
                  >
                    <option value="">Not set</option>
                    {USE_OPTIONS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Orientation">
                  <Select
                    value={editOrientation}
                    onChange={(e) => setEditOrientation(e.target.value as Orientation)}
                  >
                    {ORIENTATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="border-border rounded-lg border p-4">
                <p className="mb-3 text-sm font-medium">Audio</p>
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
                      Audio enabled
                    </Label>
                  </div>
                  <div>
                    <Label htmlFor="edit-volume">Volume ({editVolume})</Label>
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
                      Muted
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
                    Kiosk mode enabled
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
                    Auto-start on boot
                  </Label>
                </div>
              </div>

              <Field label="Notes">
                <Textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                />
              </Field>

              <div className="border-border rounded-lg border p-4">
                <p className="mb-3 text-sm font-medium">Working hours</p>
                <WorkingHoursEditor value={editWorkingHours} onChange={setEditWorkingHours} />
              </div>

              <div className="border-border flex justify-end gap-2 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  Save changes
                </Button>
              </div>
            </form>
          </Dialog>

          {/* Move dialog */}
          <Dialog
            open={moveOpen}
            onClose={() => !busy && setMoveOpen(false)}
            title="Move Screen"
            description="Assign this screen to a different location."
          >
            <div className="space-y-4">
              <Field label="Location">
                <Select value={moveLocationId} onChange={(e) => setMoveLocationId(e.target.value)}>
                  <option value="">Unassigned</option>
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
                  Cancel
                </Button>
                <Button type="button" onClick={submitMove} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  Move
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Tags dialog */}
          <Dialog
            open={tagsOpen}
            onClose={() => !busy && setTagsOpen(false)}
            title="Edit Tags"
            description="Select the tags applied to this screen."
            className="max-h-[80vh] overflow-y-auto"
          >
            <div className="space-y-4">
              {(allTags.data?.items ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">No tags available.</p>
              ) : (
                <div className="space-y-2">
                  {(allTags.data?.items ?? []).map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="border-border accent-primary size-4 rounded"
                        checked={tagIds.includes(t.id)}
                        onChange={() => toggleId(t.id, tagIds, setTagIds)}
                      />
                      {t.name}
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
                  Cancel
                </Button>
                <Button type="button" onClick={submitTags} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  Save tags
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Groups dialog */}
          <Dialog
            open={groupsOpen}
            onClose={() => !busy && setGroupsOpen(false)}
            title="Edit Groups"
            description="Select the groups this screen belongs to."
            className="max-h-[80vh] overflow-y-auto"
          >
            <div className="space-y-4">
              {(allGroups.data?.items ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">No groups available.</p>
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
                  Cancel
                </Button>
                <Button type="button" onClick={submitGroups} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  Save groups
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Kiosk PIN dialog */}
          <Dialog
            open={pinOpen}
            onClose={() => !busy && setPinOpen(false)}
            title={screen.hasKioskPin ? 'Change Kiosk PIN' : 'Set Kiosk PIN'}
            description="Enter a 4-8 digit PIN used to exit kiosk mode."
          >
            <div className="space-y-4">
              <Field label="Kiosk PIN">
                <Input
                  type="password"
                  autoComplete="off"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="e.g. 1234"
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
                  Cancel
                </Button>
                <Button type="button" onClick={submitPin} disabled={busy}>
                  {busy && <Spinner className="size-4" />}
                  Save PIN
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Pair device */}
          <Dialog
            open={pairOpen}
            onClose={() => !busy && setPairOpen(false)}
            title="Pair device"
            description="Open MasterSignage on the TV and enter the code it displays."
          >
            <div className="space-y-4">
              <Field label="Pairing code">
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
                  placeholder="e.g. A7K9Q2"
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
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy || pairCode.trim().length < 4}
                  onClick={() =>
                    runAction(
                      () => api.post(`/screens/${id}/pair`, { pairingCode: pairCode.trim() }),
                      'Device paired.',
                      () => {
                        setPairOpen(false);
                        reload();
                        pairing.reload();
                      },
                    )
                  }
                >
                  {busy && <Spinner className="size-4" />}
                  Pair
                </Button>
              </div>
            </div>
          </Dialog>

          {/* Unpair confirmation */}
          <Dialog
            open={unpairOpen}
            onClose={() => !busy && setUnpairOpen(false)}
            title="Unpair device"
            description="This revokes the device token. The screen stops playing until it is paired again."
          >
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUnpairOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => api.post(`/screens/${id}/unpair`),
                    'Device unpaired.',
                    () => {
                      setUnpairOpen(false);
                      reload();
                      pairing.reload();
                    },
                  )
                }
              >
                {busy && <Spinner className="size-4" />}
                Unpair
              </Button>
            </div>
          </Dialog>

          {/* Delete confirmation */}
          <Dialog
            open={deleteOpen}
            onClose={() => !busy && setDeleteOpen(false)}
            title="Delete Screen"
            description="This permanently removes the screen. This action cannot be undone."
          >
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="button" variant="danger" onClick={submitDelete} disabled={busy}>
                {busy && <Spinner className="size-4" />}
                Delete screen
              </Button>
            </div>
          </Dialog>
        </>
      )}
    </div>
  );
}
