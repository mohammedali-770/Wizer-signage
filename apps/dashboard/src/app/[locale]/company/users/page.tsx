'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Link2, Plus, Trash2, Users } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { CompanyUser, Invitation, Paginated, UserRole } from '@/lib/types';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
  StatusBadge,
  PageHeader,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

// Roles a company admin may assign. SUPER_ADMIN is intentionally excluded.
const INVITE_ROLES: UserRole[] = ['COMPANY_ADMIN', 'LOCATION_MANAGER', 'CONTENT_MANAGER', 'VIEWER'];

const DEFAULT_ROLE: UserRole = 'VIEWER';

export default function UsersPage() {
  const locale = useLocale();
  const t = useTranslations('pages.users');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();

  const members = useApiResource<Paginated<CompanyUser>>('/users');
  const pending = useApiResource<Paginated<Invitation>>('/invitations?status=PENDING');

  // Invite dialog state.
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>(DEFAULT_ROLE);
  const [inviting, setInviting] = useState(false);
  // The accept link generated after a successful invite (shown for copy/share).
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  // Per-row busy flags for pending-invitation actions.
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null);
  const [revoking, setRevoking] = useState(false);

  const reloadAll = () => {
    members.reload();
    pending.reload();
  };

  const buildLink = (token: string) =>
    `${window.location.origin}/${locale}/accept-invitation?token=${token}`;

  const copyLink = (link: string) =>
    navigator.clipboard
      .writeText(link)
      .then(() => toast(t('linkCopied'), 'success'))
      .catch(() => toast(t('toasts.copyFailed'), 'error'));

  const openInvite = () => {
    setEmail('');
    setRole(DEFAULT_ROLE);
    setInviteLink(null);
    setInviteOpen(true);
  };

  const closeInvite = () => {
    if (inviting) return;
    setInviteOpen(false);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast(t('toasts.emailRequired'), 'error');
      return;
    }

    setInviting(true);
    try {
      const inv = await api.post<Invitation>('/invitations', { email: trimmed, role });
      if (inv.token) {
        setInviteLink(buildLink(inv.token));
      }
      toast(t('toasts.invited'), 'success');
      reloadAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setInviting(false);
    }
  };

  // Resend to mint a fresh token, then copy the resulting accept link.
  const handleCopyPending = async (inv: Invitation) => {
    setCopyingId(inv.id);
    try {
      const r = await api.post<Invitation>(`/invitations/${inv.id}/resend`);
      if (r.token) {
        await copyLink(buildLink(r.token));
      } else {
        toast(t('toasts.error'), 'error');
      }
      pending.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setCopyingId(null);
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.del(`/invitations/${revokeTarget.id}`);
      toast(t('toasts.revoked'), 'success');
      setRevokeTarget(null);
      pending.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toasts.error'), 'error');
    } finally {
      setRevoking(false);
    }
  };

  const memberItems = members.data?.items ?? [];
  const pendingItems = pending.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={openInvite}>
            <Plus className="size-4" />
            {t('invite')}
          </Button>
        }
      />

      {/* Members */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('members.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {members.loading && (
            <div className="flex justify-center py-16">
              <Spinner className="text-primary size-6" />
            </div>
          )}

          {!members.loading && members.error && (
            <div className="p-5">
              <EmptyState title={t('members.loadError')} description={members.error} />
            </div>
          )}

          {!members.loading && !members.error && memberItems.length === 0 && (
            <div className="p-5">
              <EmptyState
                icon={<Users aria-hidden />}
                title={t('members.emptyTitle')}
                description={t('members.emptyDescription')}
              />
            </div>
          )}

          {!members.loading && !members.error && memberItems.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>{tc('name')}</TH>
                  <TH>{t('email')}</TH>
                  <TH>{t('role')}</TH>
                  <TH>{tc('status')}</TH>
                  <TH>{t('members.lastLogin')}</TH>
                  <TH>{t('members.joined')}</TH>
                </TR>
              </THead>
              <TBody>
                {memberItems.map((u) => (
                  <TR key={u.id}>
                    <TD className="text-foreground font-medium">{u.name}</TD>
                    <TD className="text-muted-foreground">{u.email}</TD>
                    <TD>{te(`userRole.${u.role}`)}</TD>
                    <TD>
                      <StatusBadge status={u.status} />
                    </TD>
                    <TD className="text-muted-foreground">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : '—'}
                    </TD>
                    <TD className="text-muted-foreground">{formatDate(u.createdAt, locale)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pending invitations */}
      <Card>
        <CardHeader>
          <CardTitle>{t('pending.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pending.loading && (
            <div className="flex justify-center py-16">
              <Spinner className="text-primary size-6" />
            </div>
          )}

          {!pending.loading && pending.error && (
            <div className="p-5">
              <EmptyState title={t('pending.loadError')} description={pending.error} />
            </div>
          )}

          {!pending.loading && !pending.error && pendingItems.length === 0 && (
            <div className="p-5">
              <EmptyState
                title={t('pending.emptyTitle')}
                description={t('pending.emptyDescription')}
              />
            </div>
          )}

          {!pending.loading && !pending.error && pendingItems.length > 0 && (
            <Table>
              <THead>
                <TR>
                  <TH>{t('email')}</TH>
                  <TH>{t('role')}</TH>
                  <TH>{t('pending.expires')}</TH>
                  <TH className="text-end">{tc('actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {pendingItems.map((inv) => (
                  <TR key={inv.id}>
                    <TD className="text-foreground font-medium">{inv.email}</TD>
                    <TD>{te(`userRole.${inv.role}`)}</TD>
                    <TD className="text-muted-foreground">{formatDate(inv.expiresAt, locale)}</TD>
                    <TD>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={copyingId === inv.id}
                          onClick={() => handleCopyPending(inv)}
                        >
                          {copyingId === inv.id ? (
                            <Spinner className="size-3.5" />
                          ) : (
                            <Copy className="size-3.5" />
                          )}
                          {t('copyLink')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(inv)}>
                          <Trash2 className="size-3.5" />
                          {t('revoke')}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onClose={closeInvite}
        title={t('inviteDialog.title')}
        description={t('inviteDialog.description')}
      >
        {inviteLink ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-sm">{t('inviteDialog.linkHelp')}</p>
            <div className="flex items-center gap-2">
              <Input value={inviteLink} readOnly aria-label={t('inviteDialog.linkLabel')} />
              <Button type="button" variant="outline" onClick={() => copyLink(inviteLink)}>
                <Link2 className="size-4" />
                {t('copyLink')}
              </Button>
            </div>
            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Button type="button" onClick={() => setInviteOpen(false)}>
                {tc('close')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <Field label={t('email')}>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('inviteDialog.emailPlaceholder')}
                required
                autoFocus
              />
            </Field>

            <Field label={t('role')} hint={t('inviteDialog.roleHint')}>
              <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {te(`userRole.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="border-border flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" onClick={closeInvite} disabled={inviting}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting && <Spinner className="size-4" />}
                {t('inviteDialog.send')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      {/* Revoke confirmation dialog */}
      <Dialog
        open={!!revokeTarget}
        onClose={() => {
          if (!revoking) setRevokeTarget(null);
        }}
        title={t('revokeDialog.title')}
        description={
          revokeTarget ? t('revokeDialog.confirm', { email: revokeTarget.email }) : undefined
        }
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevokeTarget(null)}
            disabled={revoking}
          >
            {tc('cancel')}
          </Button>
          <Button type="button" variant="danger" onClick={confirmRevoke} disabled={revoking}>
            {revoking && <Spinner className="size-4" />}
            {t('revoke')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
