'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { api, ApiError } from '@/lib/api';
import { Link, useRouter } from '@/i18n/navigation';

import { Button, Card, Field, Input, Spinner, useToast } from '@/components/ui';
import { BrandPattern } from '@/components/brand/pattern';
import { WizerMark } from '@/components/brand/logo';

const MIN_PASSWORD_LENGTH = 10;

function AcceptInvitationInner() {
  const t = useTranslations('pages.acceptInvite');
  const router = useRouter();
  const { toast } = useToast();

  const token = useSearchParams().get('token');

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      toast(t('passwordTooShort'), 'error');
      return;
    }
    if (password !== confirm) {
      toast(t('passwordMismatch'), 'error');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/accept-invitation', { token, name: name.trim(), password });
      setDone(true);
      toast(t('accountCreated'), 'success');
      router.push('/login');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('genericError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/30 relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <BrandPattern className="text-foreground/[0.035] pointer-events-none absolute inset-0 h-full w-full" />
      <Card className="relative w-full max-w-md p-8">
        <div className="mb-6 flex items-center justify-center gap-3">
          <WizerMark className="text-foreground h-11 w-11" />
          <span className="font-wordmark text-foreground text-3xl font-bold tracking-wide">
            WIZER <span className="text-primary">Signage</span>
          </span>
        </div>

        {!token ? (
          <div className="space-y-2 text-center">
            <h1 className="text-xl font-semibold">{t('invalidTitle')}</h1>
            <p className="text-muted-foreground text-sm">{t('invalidDescription')}</p>
          </div>
        ) : done ? (
          <div className="space-y-4 text-center">
            <div>
              <h1 className="text-xl font-semibold">{t('accountCreated')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('successDescription')}</p>
            </div>
            <Link
              href="/login"
              className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
            >
              {t('goToLogin')}
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{t('title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
            </div>
            <Field label={t('fullName')}>
              <Input
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label={t('password')} hint={t('passwordHint')}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Field label={t('confirmPassword')}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : t('submit')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Spinner className="text-primary size-6" />
        </div>
      }
    >
      <AcceptInvitationInner />
    </Suspense>
  );
}
