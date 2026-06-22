'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Megaphone, Plus, Zap } from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { EmergencyBroadcast, EmergencyBroadcastStatus, Paginated } from '@/lib/types';
import { TargetSelector, type SelectedTarget } from '@/components/schedules/target-selector';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Textarea,
  TR,
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

export default function EmergencyBroadcastsPage() {
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<Paginated<EmergencyBroadcast>>(
    '/emergency-broadcasts?pageSize=50',
  );

  const [quickOpen, setQuickOpen] = useState(false);
  const [qTitle, setQTitle] = useState('');
  const [qMessage, setQMessage] = useState('');
  const [qTargets, setQTargets] = useState<SelectedTarget[]>([]);
  const [sending, setSending] = useState(false);

  const sendQuick = async () => {
    if (!qTitle.trim() || !qMessage.trim())
      return toast('Title and message are required.', 'error');
    if (qTargets.length === 0) return toast('Add at least one target.', 'error');
    setSending(true);
    try {
      const created = await api.post<EmergencyBroadcast>('/emergency-broadcasts/quick-text', {
        title: qTitle.trim(),
        message: qMessage.trim(),
        targets: qTargets.map((t) =>
          t.targetType === 'COMPANY' ? { targetType: 'COMPANY', targetId: 'company' } : t,
        ),
      });
      toast('Emergency broadcast is live.', 'success');
      setQuickOpen(false);
      router.push(`/company/emergency-broadcasts/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not send broadcast.', 'error');
      setSending(false);
    }
  };

  const active = data?.items.filter((b) => b.status === 'ACTIVE') ?? [];

  return (
    <div>
      <PageHeader
        title="Emergency Broadcasts"
        description="Override all schedules on targeted screens. Use with care."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setQuickOpen(true)}>
              <Zap className="size-4" /> Quick text
            </Button>
            <Link href="/company/emergency-broadcasts/new">
              <Button>
                <Plus className="size-4" /> New broadcast
              </Button>
            </Link>
          </div>
        }
      />

      {active.length > 0 ? (
        <Card className="mb-4 border-red-500/40 bg-red-500/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-600">
            <Megaphone className="size-4" /> {active.length} broadcast{active.length > 1 ? 's' : ''}{' '}
            live now
          </p>
          <ul className="space-y-1 text-sm">
            {active.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/company/emergency-broadcasts/${b.id}`}
                  className="text-primary hover:underline"
                >
                  {b.title}
                </Link>{' '}
                <span className="text-muted-foreground">— {b.broadcastType.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load broadcasts" description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No emergency broadcasts"
          description="Create one to override schedules on specific screens during an incident."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Title</TH>
              <TH>Type</TH>
              <TH>Status</TH>
              <TH>Targets</TH>
              <TH>Priority</TH>
              <TH>Updated</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((b) => (
              <TR key={b.id}>
                <TD>
                  <Link
                    href={`/company/emergency-broadcasts/${b.id}`}
                    className="font-medium hover:underline"
                  >
                    {b.title}
                  </Link>
                </TD>
                <TD className="text-muted-foreground">{b.broadcastType}</TD>
                <TD>
                  <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                </TD>
                <TD className="text-muted-foreground">{b.targets.length}</TD>
                <TD className="text-muted-foreground">{b.priority}</TD>
                <TD className="text-muted-foreground">{formatDateTime(b.updatedAt, locale)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        title="Quick text broadcast"
        description="Create and activate a full-screen text message immediately."
      >
        <div className="space-y-3">
          <Field label="Title">
            <Input
              value={qTitle}
              onChange={(e) => setQTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Fire alarm"
            />
          </Field>
          <Field label="Message">
            <Textarea
              value={qMessage}
              onChange={(e) => setQMessage(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </Field>
          <Field label="Targets">
            <TargetSelector
              targets={qTargets}
              onAdd={(t) => setQTargets((prev) => [...prev, t])}
              onRemove={(_t, i) => setQTargets((prev) => prev.filter((_, idx) => idx !== i))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setQuickOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={sendQuick} disabled={sending}>
              {sending ? <Spinner className="size-4" /> : 'Activate now'}
            </Button>
          </div>
        </div>
      </Dialog>

      {!loading && !error ? (
        <button
          onClick={reload}
          className="text-muted-foreground hover:text-foreground mt-4 text-xs"
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}
