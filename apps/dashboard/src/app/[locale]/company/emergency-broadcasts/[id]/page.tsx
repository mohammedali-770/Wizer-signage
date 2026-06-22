'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Megaphone } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  EmergencyBroadcast,
  EmergencyBroadcastStatus,
  EmergencyBroadcastValidation,
} from '@/lib/types';
import { TargetSelector, type SelectedTarget } from '@/components/schedules/target-selector';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  PageHeader,
  Spinner,
  useToast,
} from '@/components/ui';

const STATUS_TONE: Record<
  EmergencyBroadcastStatus,
  'danger' | 'warning' | 'neutral' | 'info' | 'success'
> = {
  ACTIVE: 'danger',
  PAUSED: 'warning',
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  ENDED: 'neutral',
  ARCHIVED: 'neutral',
};

export default function EmergencyBroadcastDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const detail = useApiResource<EmergencyBroadcast>(`/emergency-broadcasts/${id}`);
  const validation = useApiResource<EmergencyBroadcastValidation>(
    `/emergency-broadcasts/${id}/validate`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'activate' | 'end'>(null);

  const reload = () => {
    detail.reload();
    validation.reload();
  };

  const act = async (path: string, label: string) => {
    setBusy(path);
    setConfirm(null);
    try {
      await api.post(`/emergency-broadcasts/${id}/${path}`);
      toast(`${label} done.`, 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Could not ${label.toLowerCase()}.`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addTarget = async (t: SelectedTarget) => {
    try {
      await api.post(`/emergency-broadcasts/${id}/targets`, t);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not add target.', 'error');
    }
  };

  const removeTarget = async (t: { id?: string }) => {
    if (!t.id) return;
    try {
      await api.del(`/emergency-broadcasts/${id}/targets/${t.id}`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not remove target.', 'error');
    }
  };

  if (detail.loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="text-primary size-6" />
      </div>
    );
  }
  if (detail.error || !detail.data) {
    return <EmptyState title="Broadcast not found" description={detail.error ?? undefined} />;
  }

  const b = detail.data;
  const v = validation.data;
  const isLive = b.status === 'ACTIVE';
  const isClosed = b.status === 'ENDED' || b.status === 'ARCHIVED';
  // TargetSelector expects {targetType, targetId}; carry the row id for removal.
  const selectedTargets: (SelectedTarget & { id: string })[] = b.targets.map((t) => ({
    id: t.id,
    targetType: t.targetType,
    targetId: t.targetId,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/company/emergency-broadcasts"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Back to broadcasts
      </Link>
      <PageHeader
        title={b.title}
        description={b.description ?? `${b.broadcastType} broadcast`}
        actions={<Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>}
      />

      {isLive ? (
        <Card className="mb-4 flex items-center gap-2 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600">
          <Megaphone className="size-4" /> This broadcast is overriding schedules on{' '}
          {b.affectedScreens ?? v?.affectedScreens ?? selectedTargets.length} screen target(s) right
          now.
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Type" value={b.broadcastType} />
            {b.broadcastType === 'TEXT' ? <Row label="Message" value={b.message ?? '—'} /> : null}
            {b.broadcastType === 'URL' ? <Row label="URL" value={b.url ?? '—'} /> : null}
            {b.broadcastType === 'CONTENT' ? (
              <Row label="Content" value={b.contentId ?? '—'} />
            ) : null}
            {b.broadcastType === 'PLAYLIST' ? (
              <Row label="Playlist" value={b.playlistId ?? '—'} />
            ) : null}
            <Row label="Priority" value={String(b.priority)} />
            <Row label="Auto-end" value={b.endAt ? new Date(b.endAt).toLocaleString() : 'Manual'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Validation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!v ? (
              <Spinner className="size-4" />
            ) : (
              <>
                <Row label="Affected screens" value={String(v.affectedScreens)} />
                <Row label="Ready to activate" value={v.canActivate ? 'Yes' : 'No'} />
                {v.errors.map((e) => (
                  <p key={e} className="text-red-600">
                    • {e}
                  </p>
                ))}
                {v.warnings.map((w) => (
                  <p key={w} className="text-amber-600">
                    ⚠ {w}
                  </p>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Targets</CardTitle>
        </CardHeader>
        <CardContent>
          <TargetSelector
            targets={selectedTargets}
            onAdd={addTarget}
            onRemove={(t) => removeTarget(t as { id?: string })}
            busy={isClosed}
          />
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        {!isClosed && !isLive ? (
          <Button
            onClick={() => setConfirm('activate')}
            disabled={busy !== null || !(v?.canActivate ?? false)}
          >
            Activate
          </Button>
        ) : null}
        {isLive ? (
          <>
            <Button
              variant="outline"
              onClick={() => act('pause', 'Pause')}
              disabled={busy !== null}
            >
              Pause
            </Button>
            <Button variant="danger" onClick={() => setConfirm('end')} disabled={busy !== null}>
              End now
            </Button>
          </>
        ) : null}
        {b.status === 'PAUSED' ? (
          <Button variant="danger" onClick={() => setConfirm('end')} disabled={busy !== null}>
            End now
          </Button>
        ) : null}
        {b.status === 'ENDED' || b.status === 'DRAFT' ? (
          <Button
            variant="outline"
            onClick={() => act('archive', 'Archive')}
            disabled={busy !== null}
          >
            Archive
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirm === 'activate'}
        onClose={() => setConfirm(null)}
        title="Activate emergency broadcast?"
        description={`This immediately overrides all schedules on ${v?.affectedScreens ?? 0} screen target(s).`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button onClick={() => act('activate', 'Activate')}>Activate now</Button>
        </div>
      </Dialog>

      <Dialog
        open={confirm === 'end'}
        onClose={() => setConfirm(null)}
        title="End emergency broadcast?"
        description="Targeted screens return to their normal schedule."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => act('end', 'End')}>
            End broadcast
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
