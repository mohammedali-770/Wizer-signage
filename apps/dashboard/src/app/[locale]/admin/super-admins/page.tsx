'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { ShieldCheck, UserPlus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatDateTime } from '@/lib/format';
import type { Paginated, SuperAdminUser } from '@/lib/types';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  StatusBadge,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  useToast,
} from '@/components/ui';

const PAGE_SIZE = 20;

export default function SuperAdminsPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApiResource<Paginated<SuperAdminUser>>(
    `/super-admin/admins?page=${page}&pageSize=${PAGE_SIZE}`,
  );

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Track which row is mid-mutation to disable just that action button.
  const [busyId, setBusyId] = useState<string | null>(null);

  const admins = data?.items ?? [];

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/super-admin/admins/invite', {
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      toast('Invitation sent', 'success');
      setInviteOpen(false);
      setEmail('');
      setName('');
      setPage(1);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(admin: SuperAdminUser) {
    const action = admin.status === 'ACTIVE' ? 'deactivate' : 'activate';
    setBusyId(admin.id);
    try {
      await api.post(`/super-admin/admins/${admin.id}/${action}`);
      toast(
        action === 'deactivate' ? 'Super Admin deactivated' : 'Super Admin activated',
        'success',
      );
      reload();
    } catch (e) {
      // e.g. the API returns 403 when trying to deactivate the last active Super Admin.
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Super Admins"
        description="Manage platform administrators with full cross-tenant access."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite Super Admin
          </Button>
        }
      />

      <div className="border-border bg-muted/30 text-muted-foreground mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm">
        <ShieldCheck className="text-primary mt-0.5 size-4 shrink-0" />
        <p>
          Two-factor authentication is mandatory for every Super Admin. Invited administrators must
          enrol a 2FA device before they can sign in, and the last active Super Admin cannot be
          deactivated.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && <EmptyState title="Could not load Super Admins" description={error} />}

      {data && admins.length === 0 && (
        <EmptyState
          title="No Super Admins found"
          description="Invite a Super Admin to grant platform-wide access."
        />
      )}

      {data && admins.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Status</TH>
                <TH>2FA</TH>
                <TH>Last login</TH>
                <TH className="text-end">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {admins.map((admin) => (
                <TR key={admin.id}>
                  <TD className="font-medium">{admin.name || '—'}</TD>
                  <TD className="text-muted-foreground">{admin.email}</TD>
                  <TD>
                    <StatusBadge status={admin.status} />
                  </TD>
                  <TD>
                    <Badge tone={admin.twoFactorEnabled ? 'success' : 'warning'}>
                      {admin.twoFactorEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground">
                    {admin.lastLoginAt ? formatDateTime(admin.lastLoginAt, locale) : 'Never'}
                  </TD>
                  <TD className="text-end">
                    {admin.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === admin.id}
                        onClick={() => toggleStatus(admin)}
                      >
                        {busyId === admin.id ? <Spinner className="size-3" /> : null}
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyId === admin.id}
                        onClick={() => toggleStatus(admin)}
                      >
                        {busyId === admin.id ? <Spinner className="size-3" /> : null}
                        Activate
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <Pagination page={page} totalPages={data.meta.totalPages} onPage={setPage} />
        </>
      )}

      <Dialog
        open={inviteOpen}
        onClose={() => (submitting ? undefined : setInviteOpen(false))}
        title="Invite Super Admin"
        description="Send an invitation to grant platform-wide administrator access."
      >
        <form onSubmit={handleInvite} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
            />
          </Field>
          <Field label="Name" hint="Optional. Shown in the admin list and audit logs.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setInviteOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !email.trim()}>
              {submitting ? <Spinner className="size-4" /> : null}
              Send invite
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
