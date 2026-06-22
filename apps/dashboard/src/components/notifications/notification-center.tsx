'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';

import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { NotificationListResponse, NotificationPreference } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import { Badge, Button, Card, EmptyState, PageHeader, Pagination, Spinner } from '@/components/ui';

const SEVERITY_TONE: Record<string, 'info' | 'warning' | 'danger' | 'neutral'> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

/** Email-eligible events users can opt out of (matches the backend defaults). */
const EMAIL_EVENTS: Array<{ key: string; label: string }> = [
  { key: 'screen.offline', label: 'Screen went offline' },
  { key: 'screen.online', label: 'Screen back online' },
  { key: 'emergency.activated', label: 'Emergency broadcast activated' },
  { key: 'emergency.ended', label: 'Emergency broadcast ended' },
  { key: 'subscription.expiring', label: 'Subscription expiring' },
  { key: 'grace.ending', label: 'Plan grace period ending' },
  { key: 'backup.failed', label: 'Backup failed' },
  { key: 'report.failed', label: 'Scheduled report failed' },
];

export function NotificationCenter() {
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const { data, loading, reload } = useApiResource<NotificationListResponse>(
    `/notifications?page=${page}&pageSize=20`,
  );

  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api
      .get<NotificationPreference[]>('/notifications/preferences')
      .then((rows) => {
        const map: Record<string, boolean> = {};
        rows.forEach((r) => (map[`${r.channel}:${r.eventType}`] = r.enabled));
        setPrefs(map);
      })
      .catch(() => undefined);
  }, []);

  const emailEnabled = (eventType: string) => prefs[`EMAIL:${eventType}`] ?? true;

  const toggleEmail = async (eventType: string) => {
    const next = !emailEnabled(eventType);
    setPrefs((p) => ({ ...p, [`EMAIL:${eventType}`]: next }));
    await api
      .put('/notifications/preferences', {
        preferences: [{ channel: 'EMAIL', eventType, enabled: next }],
      })
      .catch(() => undefined);
  };

  const markAll = async () => {
    await api.post('/notifications/read-all').catch(() => undefined);
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Your dashboard notifications and email preferences."
        actions={
          <Button variant="outline" onClick={markAll}>
            Mark all read
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title="No notifications" description="Operational notifications appear here." />
      ) : (
        <Card className="divide-border divide-y">
          {data.items.map((n) => (
            <div key={n.id} className={`flex gap-3 p-4 ${!n.readAt ? 'bg-primary/5' : ''}`}>
              <Badge tone={SEVERITY_TONE[n.severity] ?? 'neutral'}>{n.severity}</Badge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{n.title}</p>
                {n.body ? <p className="text-muted-foreground text-sm">{n.body}</p> : null}
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatDateTime(n.createdAt, locale)}
                </p>
              </div>
              {!n.readAt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
                    reload();
                  }}
                >
                  Mark read
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      {data && data.meta.totalPages > 1 ? (
        <div className="mt-4">
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />
        </div>
      ) : null}

      <Card className="mt-6 p-4">
        <p className="mb-3 text-sm font-semibold">Email notifications</p>
        <p className="text-muted-foreground mb-3 text-xs">
          Dashboard notifications are always on. Choose which events also send you an email.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EMAIL_EVENTS.map((e) => (
            <label key={e.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={emailEnabled(e.key)}
                onChange={() => toggleEmail(e.key)}
              />
              {e.label}
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
