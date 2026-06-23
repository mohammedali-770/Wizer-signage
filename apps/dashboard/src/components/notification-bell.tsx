'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import type { AppNotification, NotificationListResponse } from '@/lib/types';
import { cn } from '@/lib/cn';

const SEVERITY_DOT: Record<string, string> = {
  INFO: 'bg-blue-600',
  WARNING: 'bg-amber-500',
  CRITICAL: 'bg-red-500',
};

/**
 * Header notification bell (Phase 10). Polls the unread count every 30s and
 * shows a dropdown of recent notifications with mark-read actions. `basePath`
 * is the console root ('/company' or '/admin') for the "View all" link.
 */
export function NotificationBell({ basePath }: { basePath: string }) {
  const t = useTranslations('notifications');
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const res = await api.get<{ unreadCount: number }>('/notifications/unread-count');
      setCount(res.unreadCount);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const res = await api.get<NotificationListResponse>('/notifications?pageSize=8');
      setItems(res.items);
      setCount(res.unreadCount);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, 30_000);
    return () => clearInterval(id);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    loadItems();
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open, loadItems]);

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`).catch(() => undefined);
    await loadItems();
  };
  const markAll = async () => {
    await api.post('/notifications/read-all').catch(() => undefined);
    await loadItems();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:bg-muted hover:text-foreground relative rounded-md p-2"
        aria-label={t('title')}
      >
        <Bell className="size-5" />
        {count > 0 ? (
          <span className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-border bg-card absolute end-0 z-50 mt-2 w-80 rounded-2xl border shadow-lg">
          <div className="border-border flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">{t('title')}</span>
            <button onClick={markAll} className="text-primary text-xs hover:underline">
              {t('markAllRead')}
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-center text-sm">{t('empty')}</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'border-border hover:bg-muted flex w-full gap-2 border-b px-4 py-3 text-start',
                    !n.readAt && 'bg-primary/5',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      SEVERITY_DOT[n.severity] ?? 'bg-muted-foreground',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    {n.body ? (
                      <span className="text-muted-foreground block truncate text-xs">{n.body}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
          <Link
            href={`${basePath}/notifications`}
            onClick={() => setOpen(false)}
            className="border-border text-primary block border-t px-4 py-2 text-center text-sm hover:underline"
          >
            {t('viewAll')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
