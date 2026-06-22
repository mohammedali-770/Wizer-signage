'use client';

import { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import { useAuth, type TwoFactorSetup } from '@/lib/auth-context';
import { useRouter } from '@/i18n/navigation';
import { Button, Card, Field, Input, Spinner, useToast } from '@/components/ui';

type Step = 'login' | '2fa' | 'enroll' | 'backup';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
}

export default function LoginPage() {
  const {
    status,
    needsTwoFactorSetup,
    login,
    verifyTwoFactor,
    beginEnrollment,
    completeEnrollment,
  } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    if (step === 'login') router.replace('/');
  }, [status, needsTwoFactorSetup, step, router]);

  // Lazily fetch the TOTP secret/QR when entering the enrolment step.
  useEffect(() => {
    if (step === 'enroll' && !setup) {
      beginEnrollment()
        .then(setSetup)
        .catch((e) => toast(errorMessage(e), 'error'));
    }
  }, [step, setup, beginEnrollment, toast]);

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
        router.replace('/');
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
      router.replace('/');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const codes = await completeEnrollment(code.trim());
      setBackupCodes(codes);
      setStep('backup');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-2">
          <div className="bg-primary size-8 rounded-md" />
          <span className="text-lg font-semibold">MasterSignage</span>
        </div>

        {step === 'login' && (
          <form onSubmit={onLogin} className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Sign in</h1>
              <p className="text-muted-foreground mt-1 text-sm">Super Admin console</p>
            </div>
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : 'Sign in'}
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

        {step === 'enroll' && (
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
            <Button className="w-full" onClick={() => router.replace('/')}>
              I have saved them — continue
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
