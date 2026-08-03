'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';

import { api } from '@/lib/api';
import { invalidateApiCache } from '@/lib/api-cache';
import { beginImpersonation } from '@/lib/impersonation';
import { Button, Dialog, Field, Input, Spinner, useToast } from '@/components/ui';

interface StartResponse {
  accessToken: string;
  expiresAt: string;
  company: { id: string; name: string };
}

/**
 * Starts an audited impersonation of one company.
 *
 * Both inputs are required by the API, and both are deliberate: the code
 * re-authenticates the admin at the moment of the act (a session hijacked hours
 * ago cannot silently pivot into a tenant), and the reason is written to the
 * CUSTOMER's audit trail as well as the platform's — so the dialog says so
 * rather than presenting it as an internal note.
 */
export function ImpersonateButton({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const t = useTranslations('impersonation');
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<StartResponse>('/super-admin/impersonation', {
        companyId,
        reason: reason.trim(),
        twoFactorCode: code.trim(),
      });
      beginImpersonation(res.accessToken, {
        companyId: res.company.id,
        companyName: res.company.name,
        expiresAt: res.expiresAt,
      });
      // The cache holds platform-scoped responses fetched as the admin; leaving
      // them would show the wrong tenant's data behind the banner.
      invalidateApiCache();
      window.location.href = '/company';
    } catch {
      toast(t('failed'), 'error');
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Eye className="size-4" />
        {t('button')}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('dialogTitle')}
        description={t('dialogDescription')}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-foreground text-sm font-medium">{companyName}</p>

          <Field label={t('reasonLabel')}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
              minLength={10}
              maxLength={500}
              required
            />
          </Field>
          <Field label={t('codeLabel')}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('codePlaceholder')}
              autoComplete="one-time-code"
              required
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t('exit')}
            </Button>
            <Button type="submit" disabled={busy || reason.trim().length < 10 || !code.trim()}>
              {busy ? <Spinner className="size-4" /> : null}
              {t('submit')}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
