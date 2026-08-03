'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ArrowLeft, Ban, Copy, Pencil, ShieldCheck, UserPlus } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { api, ApiError } from '@/lib/api';
import { ImpersonateButton } from '@/components/admin/impersonate-button';
import { useApiResource } from '@/lib/use-api';
import { formatBytes, formatDate, formatNumber } from '@/lib/format';
import type {
  CompanyDetail,
  Invitation,
  PlanLimits,
  ResourceUsage,
  UsageEvaluation,
} from '@/lib/types';
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

/** Translation sub-key for each usage resource row label. */
const RESOURCE_LABEL_KEYS: Record<ResourceUsage['key'], string> = {
  users: 'resourceUsers',
  locations: 'resourceLocations',
  screens: 'resourceScreens',
  storageGb: 'resourceStorage',
};

/** Plan-limit fields paired with their translation sub-key. */
const LIMIT_FIELDS: Array<{ key: keyof PlanLimits; labelKey: string }> = [
  { key: 'maxUsers', labelKey: 'limitUsers' },
  { key: 'maxLocations', labelKey: 'limitLocations' },
  { key: 'maxScreens', labelKey: 'limitScreens' },
  { key: 'storageGb', labelKey: 'limitStorageGb' },
  { key: 'maxFileSizeMb', labelKey: 'limitMaxFileSizeMb' },
  { key: 'autoScreenshotsPerDay', labelKey: 'limitScreenshotsPerDay' },
  { key: 'scheduledReports', labelKey: 'limitScheduledReports' },
  { key: 'dataRetentionDays', labelKey: 'limitDataRetentionDays' },
  { key: 'apiRequestsPerDay', labelKey: 'limitApiRequestsPerDay' },
  { key: 'webhooks', labelKey: 'limitWebhooks' },
];

function formatLimit(
  value: number | null | undefined,
  locale: string,
  unlimitedLabel: string,
): string {
  if (value === null || value === undefined) return unlimitedLabel;
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
  const t = useTranslations('pages.adminCompanyDetail');
  if (resource.key === 'storageGb') {
    const used = formatBytes(usage.storageBytes, locale);
    const limit = resource.unlimited
      ? t('unlimited')
      : `${formatNumber(resource.limit ?? 0, locale)} GB`;
    return (
      <span>
        {used} <span className="text-muted-foreground">/ {limit}</span>
      </span>
    );
  }
  const limit = resource.unlimited ? t('unlimited') : formatNumber(resource.limit ?? 0, locale);
  return (
    <span>
      {formatNumber(resource.used, locale)} <span className="text-muted-foreground">/ {limit}</span>
    </span>
  );
}

function ResourceStatusBadge({ resource }: { resource: ResourceUsage }) {
  const t = useTranslations('pages.adminCompanyDetail');
  if (resource.exceeded) return <Badge tone="danger">{t('resourceExceeded')}</Badge>;
  if (resource.approaching) return <Badge tone="warning">{t('resourceApproaching')}</Badge>;
  return <Badge tone="success">{t('resourceOk')}</Badge>;
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
  const t = useTranslations('pages.adminCompanyDetail');
  const tc = useTranslations('common');
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data, loading, error, reload } = useApiResource<CompanyDetail>(
    id ? `/companies/${id}` : null,
  );

  const [editOpen, setEditOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');

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
      toast(t('toastReactivated'), 'success');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
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
      toast(t('toastSuspended'), 'success');
      setSuspendOpen(false);
      setSuspendReason('');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
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
      toast(t('toastUpdated'), 'success');
      setEditOpen(false);
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function openInvite() {
    setInviteEmail('');
    setInviteLink('');
    setInviteOpen(true);
  }

  async function handleInvite() {
    if (!id) return;
    setBusy(true);
    try {
      const inv = await api.post<Invitation>('/invitations', {
        email: inviteEmail.trim(),
        role: 'COMPANY_ADMIN',
        companyId: id,
      });
      const link = `${window.location.origin}/${locale}/accept-invitation?token=${inv.token}`;
      setInviteLink(link);
      toast(t('invite.toastCreated'), 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function handleCopyLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => toast(t('invite.linkCopied'), 'success'));
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
        {t('backToCompanies')}
      </Link>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && data && company && (
        <div className="space-y-6">
          <PageHeader
            title={company.name}
            description={`${company.slug} · ${company.timezone} · ${company.defaultLocale.toUpperCase()}`}
            actions={
              <>
                <StatusBadge status={company.status} />
                <ImpersonateButton companyId={company.id} companyName={company.name} />
                <Button variant="outline" onClick={openInvite}>
                  <UserPlus className="size-4" />
                  {t('invite.addAdmin')}
                </Button>
                <Button variant="outline" onClick={() => setEditOpen(true)}>
                  <Pencil className="size-4" />
                  {tc('edit')}
                </Button>
                {company.status === 'SUSPENDED' ? (
                  <Button onClick={handleReactivate} disabled={busy}>
                    <ShieldCheck className="size-4" />
                    {t('reactivate')}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setSuspendOpen(true)} disabled={busy}>
                    <Ban className="size-4" />
                    {t('suspend')}
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
                <p className="font-medium">{t('suspendedNotice')}</p>
                {company.suspendedReason ? (
                  <p className="mt-0.5">
                    {t('suspendedReason', { reason: company.suspendedReason })}
                  </p>
                ) : null}
                {company.suspendedAt ? (
                  <p className="mt-0.5 text-red-600/80 dark:text-red-300/80">
                    {t('suspendedAt', { date: formatDate(company.suspendedAt, locale) })}
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
                <p className="font-medium">{t('graceTitle')}</p>
                {usage.gracePeriodEndsAt ? (
                  <p className="mt-0.5">
                    {t('graceEnds', { date: formatDate(usage.gracePeriodEndsAt, locale) })}
                  </p>
                ) : null}
              </div>
            </div>
          )}
          {usage?.status === 'blocked' && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium">{t('blockedTitle')}</p>
                <p className="mt-0.5">{t('blockedDescription')}</p>
              </div>
            </div>
          )}

          {/* Metrics / usage */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t('resourceUsageTitle')}</CardTitle>
              {usage ? <StatusBadge status={usage.status.toUpperCase()} /> : null}
            </CardHeader>
            <CardContent className="px-0 py-0">
              {usage ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('resourceColumn')}</TH>
                      <TH>{t('usedLimitColumn')}</TH>
                      <TH>{t('usageColumn')}</TH>
                      <TH className="text-end">{tc('status')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {usage.resources.map((resource) => (
                      <TR key={resource.key}>
                        <TD className="font-medium">{t(RESOURCE_LABEL_KEYS[resource.key])}</TD>
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
                  <EmptyState title={t('noUsageData')} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subscription */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{t('subscriptionTitle')}</CardTitle>
              {subscription ? (
                <Link
                  href="/admin/subscriptions"
                  className="text-primary text-xs font-medium hover:underline"
                >
                  {t('manageOnSubscriptions')}
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
                      <dt className="text-muted-foreground text-xs">{t('trialEnds')}</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.trialEndsAt
                          ? formatDate(subscription.trialEndsAt, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('periodStart')}</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.currentPeriodStart
                          ? formatDate(subscription.currentPeriodStart, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('periodEnd')}</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.currentPeriodEnd
                          ? formatDate(subscription.currentPeriodEnd, locale)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground text-xs">{t('cancelAtPeriodEnd')}</dt>
                      <dd className="mt-0.5 font-medium">
                        {subscription.cancelAtPeriodEnd ? t('yes') : t('no')}
                      </dd>
                    </div>
                    {subscription.gracePeriodEndsAt ? (
                      <div>
                        <dt className="text-muted-foreground text-xs">{t('gracePeriodEnds')}</dt>
                        <dd className="mt-0.5 font-medium">
                          {formatDate(subscription.gracePeriodEndsAt, locale)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>

                  <div>
                    <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                      {t('planLimits')}
                    </p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-4">
                      {LIMIT_FIELDS.map(({ key, labelKey }) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <dt className="text-muted-foreground">{t(labelKey)}</dt>
                          <dd className="font-medium">
                            {formatLimit(subscription.plan.limits[key], locale, t('unlimited'))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title={t('noSubscriptionTitle')}
                  description={t('noSubscriptionDescription')}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add admin dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('invite.dialogTitle')}
        description={t('invite.dialogDescription')}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleInvite();
          }}
        >
          <Field label={t('invite.emailLabel')}>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('invite.emailPlaceholder')}
              required
              disabled={!!inviteLink}
            />
          </Field>

          {inviteLink ? (
            <Field label={t('invite.linkLabel')} hint={t('invite.linkHint')}>
              <div className="flex items-center gap-2">
                <Input value={inviteLink} readOnly />
                <Button type="button" variant="outline" onClick={handleCopyLink}>
                  <Copy className="size-4" />
                  {t('invite.copyLink')}
                </Button>
              </div>
            </Field>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setInviteOpen(false)}
              disabled={busy}
            >
              {inviteLink ? tc('close') : tc('cancel')}
            </Button>
            {inviteLink ? null : (
              <Button type="submit" disabled={busy || !inviteEmail.trim()}>
                {busy ? <Spinner className="size-4" /> : null}
                {t('invite.createButton')}
              </Button>
            )}
          </div>
        </form>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t('editDialogTitle')}
        description={t('editDialogDescription')}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleEditSave();
          }}
        >
          <Field label={tc('name')}>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('defaultLocale')} hint={t('defaultLocaleHint')}>
              <Input
                value={form.defaultLocale}
                onChange={(e) => setForm((f) => ({ ...f, defaultLocale: e.target.value }))}
              />
            </Field>
            <Field label={t('timezone')} hint={t('timezoneHint')}>
              <Input
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('primaryColor')} hint={t('primaryColorHint')}>
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
            <Field label={t('customDomain')} hint={t('customDomainHint')}>
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
              {tc('cancel')}
            </Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy ? <Spinner className="size-4" /> : null}
              {t('saveChanges')}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Suspend dialog */}
      <Dialog
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={t('suspendDialogTitle')}
        description={t('suspendDialogDescription')}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSuspend();
          }}
        >
          <Field label={t('reasonLabel')}>
            <Textarea
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSuspendOpen(false)}
              disabled={busy}
            >
              {tc('cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={busy}>
              {busy ? <Spinner className="size-4" /> : null}
              {t('suspendCompany')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
