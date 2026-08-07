'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { ApiError } from '@/lib/api';
import { useAuth, type TwoFactorSetup } from '@/lib/auth-context';
import { useRouter } from '@/i18n/navigation';
import { roleHome } from '@/lib/roles';

import { Button, Card, Field, Input, Spinner, useToast } from '@/components/ui';
import { BrandPattern } from '@/components/brand/pattern';
import { WizerMark } from '@/components/brand/logo';

type Step = 'login' | '2fa' | 'enroll' | 'backup';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const {
    status,
    user,
    needsTwoFactorSetup,
    login,
    verifyTwoFactor,
    beginEnrollment,
    completeEnrollment,
  } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('pages.login');

  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Separate box for the re-auth prompt, so it never writes into the sign-in
  // field mid-flow.
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Already signed in? Send to the role-aware root (or into forced enrolment).
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (needsTwoFactorSetup) {
      setStep('enroll');
      return;
    }
    // Only auto-redirect an already-authenticated visitor — never while showing
    // the one-time backup codes mid-enrolment.
    if (step === 'login') router.replace(roleHome(user?.role));
  }, [status, needsTwoFactorSetup, step, router]);

  // Lazily fetch the TOTP secret/QR when entering the enrolment step.
  //
  // Gated on holding the password, because /auth/2fa/setup now re-authenticates.
  // Arriving here straight from the login form we already have it and the fetch
  // is invisible; arriving on a reload of an authenticated-but-unenrolled
  // session we do not, and the password form below runs first. On failure the
  // password is dropped so that form comes back — otherwise a wrong password
  // (or a throttled attempt) would leave the step with no way forward.
  useEffect(() => {
    if (step === 'enroll' && !setup && password) {
      beginEnrollment(password)
        .then(setSetup)
        .catch((e) => {
          setPassword('');
          toast(errorMessage(e), 'error');
        });
    }
  }, [step, setup, password, beginEnrollment, toast]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login(email.trim(), password);
      if (result.next === '2fa') {
        setChallengeToken(result.challengeToken);
        setCode('');
        setStep('2fa');
      } else if (result.next === 'enroll') {
        setStep('enroll');
      } else {
        router.replace(roleHome(user?.role));
      }
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verifyTwoFactor(challengeToken, code.trim());
      router.replace(roleHome(user?.role));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Confirms the password when we arrived at enrolment without one (a reload of
  // an authenticated session that still owes its 2FA setup). Setting it is all
  // this does — the effect above sees the change and fetches the QR.
  function onConfirmPassword(e: React.FormEvent) {
    e.preventDefault();
    setPassword(passwordConfirm);
    setPasswordConfirm('');
  }

  async function onEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const codes = await completeEnrollment(code.trim(), password);
      setBackupCodes(codes);
      setStep('backup');
    } catch (e) {
      toast(errorMessage(e), 'error');
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

        {step === 'login' && (
          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{t('title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
            </div>
            <Field label={t('email')}>
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t('password')}>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : t('signIn')}
            </Button>
          </form>
        )}

        {step === '2fa' && (
          <form onSubmit={onVerify} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Two-factor authentication</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Enter the 6-digit code from your authenticator app (or a backup code).
              </p>
            </div>
            <Field label="Authentication code">
              <Input
                inputMode="numeric"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : 'Verify'}
            </Button>
          </form>
        )}

        {/* Re-auth prompt: only when we reached enrolment without the password
            (a reload of a session that still owes its 2FA setup). */}
        {step === 'enroll' && !setup && !password && (
          <form onSubmit={onConfirmPassword} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Confirm your password</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Enrolling an authenticator changes how you sign in, so it needs your password — not
                just an open session.
              </p>
            </div>
            <Field label={t('password')}>
              <Input
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        )}

        {step === 'enroll' && (!!setup || !!password) && (
          <form onSubmit={onEnable} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Set up two-factor authentication</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Two-factor authentication is mandatory for Super Admins. Scan the QR code with your
                authenticator app, then enter the generated code.
              </p>
            </div>
            {setup ? (
              <div className="space-y-3">
                <div className="border-border flex justify-center rounded-lg border bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qrCodeDataUrl} alt="2FA QR code" className="size-44" />
                </div>
                <p className="text-muted-foreground text-center text-xs">
                  Or enter this secret manually: <span className="font-mono">{setup.secret}</span>
                </p>
                <Field label="Authentication code">
                  <Input
                    inputMode="numeric"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                </Field>
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? <Spinner /> : 'Enable & continue'}
                </Button>
              </div>
            ) : (
              <div className="flex justify-center py-8">
                <Spinner className="text-primary size-6" />
              </div>
            )}
          </form>
        )}

        {step === 'backup' && (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Save your backup codes</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Store these one-time recovery codes somewhere safe. They will not be shown again.
              </p>
            </div>
            <div className="border-border bg-muted/40 grid grid-cols-2 gap-2 rounded-lg border p-4 font-mono text-sm">
              {backupCodes.map((bc) => (
                <span key={bc}>{bc}</span>
              ))}
            </div>
            <Button className="w-full" onClick={() => router.replace(roleHome(user?.role))}>
              I have saved them — continue
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
