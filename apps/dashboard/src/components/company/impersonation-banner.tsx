'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldAlert } from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { invalidateApiCache } from '@/lib/api-cache';
import { endImpersonation, getImpersonation, type ImpersonationState } from '@/lib/impersonation';
import { Button } from '@/components/ui';

/**
 * Always-visible marker that the console is being viewed as a tenant.
 *
 * Impersonation without a persistent, unmissable indicator is the failure mode
 * that turns a support tool into an incident: an admin forgets which tenant they
 * are in and edits the wrong customer's playlists. The banner is sticky, states
 * the company by name, counts down to expiry, and offers the single action that
 * gets out of the state.
 */
export function ImpersonationBanner() {
  const t = useTranslations('impersonation');
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [remaining, setRemaining] = useState('');
  const [leaving, setLeaving] = useState(false);

  // Read on mount, then re-evaluate every second: the token dies on its own, and
  // a banner that outlives it would claim an authority the next request lacks.
  useEffect(() => {
    const tick = () => {
      const current = getImpersonation();
      setState(current);
      if (!current) {
        setRemaining('');
        return;
      }
      const ms = new Date(current.expiresAt).getTime() - Date.now();
      const minutes = Math.floor(ms / 60_000);
      const seconds = Math.floor((ms % 60_000) / 1000);
      setRemaining(`${minutes}:${String(seconds).padStart(2, '0')}`);
    };
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, []);

  if (!state) return null;

  const leave = async () => {
    setLeaving(true);
    // Tell the API first so the session is revoked server-side, but never let a
    // failed call trap the admin inside the tenant — the local exit runs either
    // way, and the session expires on its own within the TTL regardless.
    await apiFetch('/super-admin/impersonation', { method: 'DELETE' }).catch(() => undefined);
    const restored = endImpersonation();
    invalidateApiCache();
    window.location.href = restored ? '/admin' : '/login';
  };

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center gap-x-4 gap-y-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span>{t('viewingAs', { company: state.companyName })}</span>
      <span className="tabular-nums opacity-80">{t('expiresIn', { remaining })}</span>
      <Button
        type="button"
        onClick={leave}
        disabled={leaving}
        className="ms-auto bg-amber-950 text-amber-50 hover:bg-amber-900"
      >
        {t('exit')}
      </Button>
    </div>
  );
}
