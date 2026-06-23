'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  const locale = useLocale();
  const t = useTranslations('pages.emergency.detail');
  const tt = useTranslations('pages.emergency.types');
  const tc = useTranslations('common');
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

  const act = async (path: string, successMsg: string, errorMsg: string) => {
    setBusy(path);
    setConfirm(null);
    try {
      await api.post(`/emergency-broadcasts/${id}/${path}`);
      toast(successMsg, 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : errorMsg, 'error');
    } finally {
      setBusy(null);
    }
  };

  const addTarget = async (target: SelectedTarget) => {
    try {
      await api.post(`/emergency-broadcasts/${id}/targets`, target);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errAddTarget'), 'error');
    }
  };

  const removeTarget = async (target: { id?: string }) => {
    if (!target.id) return;
    try {
      await api.del(`/emergency-broadcasts/${id}/targets/${target.id}`);
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('errRemoveTarget'), 'error');
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
    return <EmptyState title={t('notFound')} description={detail.error ?? undefined} />;
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
        <ArrowLeft className="size-4" /> {t('back')}
      </Link>
      <PageHeader
        title={b.title}
        description={b.description ?? t('typeBroadcast', { type: tt(b.broadcastType) })}
        actions={<Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>}
      />

      {isLive ? (
        <Card className="mb-4 flex items-center gap-2 border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600">
          <Megaphone className="size-4" />{' '}
          {t('overriding', {
            count: b.affectedScreens ?? v?.affectedScreens ?? selectedTargets.length,
          })}
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('contentTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={tc('type')} value={tt(b.broadcastType)} />
            {b.broadcastType === 'TEXT' ? (
              <Row label={t('messageLabel')} value={b.message ?? '—'} />
            ) : null}
            {b.broadcastType === 'URL' ? <Row label={t('urlLabel')} value={b.url ?? '—'} /> : null}
            {b.broadcastType === 'CONTENT' ? (
              <Row label={t('contentLabel')} value={b.contentId ?? '—'} />
            ) : null}
            {b.broadcastType === 'PLAYLIST' ? (
              <Row label={t('playlistLabel')} value={b.playlistId ?? '—'} />
            ) : null}
            <Row label={t('priorityLabel')} value={String(b.priority)} />
            <Row
              label={t('autoEndLabel')}
              value={b.endAt ? new Date(b.endAt).toLocaleString(locale) : t('manual')}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('validationTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!v ? (
              <Spinner className="size-4" />
            ) : (
              <>
                <Row label={t('affectedScreens')} value={String(v.affectedScreens)} />
                <Row label={t('readyToActivate')} value={v.canActivate ? t('yes') : t('no')} />
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
          <CardTitle>{t('targetsTitle')}</CardTitle>
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
            {t('activate')}
          </Button>
        ) : null}
        {isLive ? (
          <>
            <Button
              variant="outline"
              onClick={() => act('pause', t('pauseDone'), t('pauseError'))}
              disabled={busy !== null}
            >
              {t('pause')}
            </Button>
            <Button variant="danger" onClick={() => setConfirm('end')} disabled={busy !== null}>
              {t('endNow')}
            </Button>
          </>
        ) : null}
        {b.status === 'PAUSED' ? (
          <Button variant="danger" onClick={() => setConfirm('end')} disabled={busy !== null}>
            {t('endNow')}
          </Button>
        ) : null}
        {b.status === 'ENDED' || b.status === 'DRAFT' ? (
          <Button
            variant="outline"
            onClick={() => act('archive', t('archiveDone'), t('archiveError'))}
            disabled={busy !== null}
          >
            {t('archive')}
          </Button>
        ) : null}
      </div>

      <Dialog
        open={confirm === 'activate'}
        onClose={() => setConfirm(null)}
        title={t('activateConfirmTitle')}
        description={t('activateConfirmDescription', { count: v?.affectedScreens ?? 0 })}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            {tc('cancel')}
          </Button>
          <Button onClick={() => act('activate', t('activateDone'), t('activateError'))}>
            {t('activateNow')}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirm === 'end'}
        onClose={() => setConfirm(null)}
        title={t('endConfirmTitle')}
        description={t('endConfirmDescription')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" onClick={() => act('end', t('endDone'), t('endError'))}>
            {t('endBroadcast')}
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
      <span className="text-end font-medium">{value}</span>
    </div>
  );
}
