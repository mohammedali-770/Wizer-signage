'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { AlertTriangle, ArrowLeft, Ban, Pencil, ShieldCheck } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatBytes, formatDate, formatNumber } from '@/lib/format';
import type { CompanyDetail, PlanLimits, ResourceUsage, UsageEvaluation } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  useToast,
} from '@/components/ui';

/** Human label for each usage resource row. */
const RESOURCE_LABELS: Record<ResourceUsage['key'], string> = {
  users: 'Users',
  locations: 'Locations',
  screens: 'Screens',
  storageGb: 'Storage',
};

/** Label + value pairs describing the limits attached to the active plan. */
const LIMIT_FIELDS: Array<{ key: keyof PlanLimits; label: string }> = [
  { key: 'maxUsers', label: 'Users' },
  { key: 'maxLocations', label: 'Locations' },
  { key: 'maxScreens', label: 'Screens' },
  { key: 'storageGb', label: 'Storage (GB)' },
  { key: 'maxFileSizeMb', label: 'Max file size (MB)' },
  { key: 'autoScreenshotsPerDay', label: 'Screenshots / day' },
  { key: 'scheduledReports', label: 'Scheduled reports' },
  { key: 'dataRetentionDays', label: 'Data retention (days)' },
  { key: 'apiRequestsPerDay', label: 'API requests / day' },
  { key: 'webhooks', label: 'Webhooks' },
];

function formatLimit(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined) return 'Unlimited';
  return formatNumber(value, locale);
}

/** Render the "used / limit" cell for a usage resource, formatting storage in bytes. */
function ResourceUsageCell({
  resource,
  usage,
  locale,
}: {
  resource: ResourceUsage;
  usage: UsageEvaluation['usage'];
  locale: string;
}) {
  if (resource.key === 'storageGb') {
    const used = formatBytes(usage.storageBytes, locale);
    const limit = resource.unlimited
      ? 'Unlimited'
      : `${formatNumber(resource.limit ?? 0, locale)} GB`;
    return (
      <span>
        {used} <span className="text-muted-foreground">/ {limit}</span>
      </span>
    );
  }
  const limit = resource.unlimited ? 'Unlimited' : formatNumber(resource.limit ?? 0, locale);
  return (
    <span>
      {formatNumber(resource.used, locale)} <span className="text-muted-foreground">/ {limit}</span>
    </span>
  );
}

function ResourceStatusBadge({ resource }: { resource: ResourceUsage }) {
  if (resource.exceeded) return <Badge tone="danger">Exceeded</Badge>;
  if (resource.approaching) return <Badge tone="warning">Approaching</Badge>;
  return <Badge tone="success">OK</Badge>;
}

interface EditForm {
  name: string;
  defaultLocale: string;
  timezone: string;
  primaryColor: string;
  customDomain: string;
}

export default function CompanyDetailPage() {
  const locale = useLocale();
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data, loading, error, reload } = useApiResource<CompanyDetail>(
    id ? `/companies/${id}` : null,
  );

  const [editOpen, setEditOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState<EditForm>({
    name: '',
    defaultLocale: '',
    timezone: '',
    primaryColor: '',
    customDomain: '',
  });

  const company = data?.company ?? null;

  // Seed the edit form whenever the dialog opens with the latest company values.
  useEffect(() => {
    if (editOpen && company) {
      setForm({
        name: company.name,
        defaultLocale: company.defaultLocale,
        timezone: company.timezone,
        primaryColor: company.primaryColor ?? '',
        customDomain: company.customDomain ?? '',
      });
    }
  }, [editOpen, company]);

  async function handleReactivate() {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/companies/${id}/reactivate`);
      toast('Company reactivated.', 'success');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleSuspend() {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/companies/${id}/suspend`, {
        reason: suspendReason.trim() || undefined,
      });
      toast('Company suspended.', 'success');
      setSuspendOpen(false);
      setSuspendReason('');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSave() {
    if (!id) return;
    setBusy(true);
    try {
      await api.patch(`/companies/${id}`, {
        name: form.name.trim(),
        defaultLocale: form.defaultLocale.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
        primaryColor: form.primaryColor.trim() || null,
        customDomain: form.customDomain.trim() || null,
      });
      toast('Company updated.', 'success');
      setEditOpen(false);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const subscription = data?.subscription ?? null;
  const usage = data?.usage ?? null;

  return (
    <div>
      <Link
        href="/admin/companies"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        Back to companies
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {error && <EmptyState title="Could not load company" description={error} />}

      {!loading && !error && data && company && (
        <div className="space-y-6">
          <PageHeader
            title={company.name}
            description={`${company.slug} · ${company.timezone} · ${company.defaultLocale.toUpperCase()}`}
            actions={
              <>
                <StatusBadge status={company.status} />
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
                {company.status === 'SUSPENDED' ? (
                  <Button onClick={handleReactivate} disabled={busy}>
                    <ShieldCheck className="size-4" />
                    Reactivate
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setSuspendOpen(true)} disabled={busy}>
                    <Ban className="size-4" />
                    Suspend
                  </Button>
                )}
              </>
            }
          />

          {/* Suspension notice */}
          {company.status === 'SUSPENDED' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <Ban className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">This company is suspended.</p>
                {company.suspendedReason ? (
                  <p className="mt-0.5">Reason: {company.suspendedReason}</p>
                ) : null}
                {company.suspendedAt ? (
                  <p className="mt-0.5 text-red-600/80 dark:text-red-300/80">
                    Suspended {formatDate(company.suspendedAt, locale)}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {/* Usage status banners */}
          {usage?.status === 'grace' && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Usage limits exceeded — grace period active.</p>
                {usage.gracePeriodEndsAt ? (
                  <p className="mt-0.5">
                    Grace period ends {formatDate(usage.gracePeriodEndsAt, locale)}.
                  </p>
                ) : null}
              </div>
            </div>
          )}
          {usage?.status === 'blocked' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">Usage limits exceeded — account blocked.</p>
                <p className="mt-0.5">
                  The grace period has expired. Resources are blocked until usage is reduced or the
                  plan is upgraded.
                </p>
              </div>
            </div>
          )}

          {/* Metrics / usage */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Resource usage</CardTitle>
              {usage ? <StatusBadge status={usage.status.toUpperCase()} /> : null}
            </CardHeader>
            <CardContent className="px-0 py-0">
              {usage ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Resource</TH>
                      <TH>Used / Limit</TH>
                      <TH>Usage</TH>
                      <TH className="text-end">Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {usage.resources.map((resource) => (
                      <TR key={resource.key}>
                        <TD className="font-medium">{RESOURCE_LABELS[resource.key]}</TD>
                        <TD>
                          <ResourceUsageCell
                            resource={resource}
                            usage={usage.usage}
                            locale={locale}
                          />
                        </TD>
                        <TD className="text-muted-foreground">
                          {resource.percentUsed === null
                            ? '—'
                            : `${formatNumber(Math.round(resource.percentUsed), locale)}%`}
                        </TD>
                        <TD className="text-end">
                          <ResourceStatusBadge resource={resource} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ) : (
                <div className="px-5 py-4">
                  <EmptyState title="No usage data available." />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Subscription</CardTitle>
              {subscription ? (
                <Link
                  href="/admin/subscriptions"
                  className="text-primary text-xs font-medium hover:underline"
                >
                  Manage on Subscriptions
                </Link>
              ) : null}
            </CardHeader>
            <CardContent>
              {subscription ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold">{subscription.plan.name}</p>
                      <p className="text-muted-foreground text-xs">{subscription.plan.code}</p>
                    </div>
                    <StatusBadge status={subscription.status} />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground text-xs">Trial ends</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.trialEndsAt
                          ? formatDate(subscription.trialEndsAt, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Period start</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.currentPeriodStart
                          ? formatDate(subscription.currentPeriodStart, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Period end</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.currentPeriodEnd
                          ? formatDate(subscription.currentPeriodEnd, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">Cancel at period end</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.cancelAtPeriodEnd ? 'Yes' : 'No'}
                      </dd>
                    </div>
                    {subscription.gracePeriodEndsAt ? (
                      <div>
                        <dt className="text-muted-foreground text-xs">Grace period ends</dt>
                        <dd className="mt-0.5 font-medium">
                          {formatDate(subscription.gracePeriodEndsAt, locale)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <div>
                    <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                      Plan limits
                    </p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                      {LIMIT_FIELDS.map(({ key, label }) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="font-medium">
                            {formatLimit(subscription.plan.limits[key], locale)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="No active subscription"
                  description="This company is not currently subscribed to a plan."
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit company"
        description="Update the company profile and branding."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleEditSave();
          }}
        >
          <Field label="Name">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Default locale" hint="e.g. en, ar">
              <Input
                value={form.defaultLocale}
                onChange={(e) => setForm((f) => ({ ...f, defaultLocale: e.target.value }))}
              />
            </Field>
            <Field label="Timezone" hint="e.g. UTC, Asia/Riyadh">
              <Input
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Primary color" hint="Hex, e.g. #2563eb">
              <div className="flex items-center gap-2">
                <Input
                  value={form.primaryColor}
                  onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
                  placeholder="#2563eb"
                />
                <span
                  className="border-border size-9 shrink-0 rounded-md border"
                  style={{ backgroundColor: form.primaryColor || 'transparent' }}
                  aria-hidden
                />
              </div>
            </Field>
            <Field label="Custom domain" hint="e.g. signage.acme.com">
              <Input
                value={form.customDomain}
                onChange={(e) => setForm((f) => ({ ...f, customDomain: e.target.value }))}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy ? <Spinner className="size-4" /> : null}
              Save changes
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Suspend dialog */}
      <Dialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Suspend company"
        description="Suspending blocks access for all members of this company. You can reactivate later."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSuspend();
          }}
        >
          <Field label="Reason (optional)">
            <Textarea
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Add a note explaining why this company is being suspended."
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSuspendOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : null}
              Suspend company
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
