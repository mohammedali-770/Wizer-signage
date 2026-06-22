'use client';

import { useLocale } from 'next-intl';
import { Building2, Monitor, Users } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { formatNumber } from '@/lib/format';
import type { CompanySettings, ResourceUsage, UsageEvaluation } from '@/lib/types';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';

function limitLabel(r: ResourceUsage | undefined, locale: string): string {
  if (!r) return '—';
  const limit = r.unlimited || r.limit === null ? '∞' : formatNumber(r.limit, locale);
  return `${formatNumber(r.used, locale)} / ${limit}`;
}

function usageTone(r: ResourceUsage | undefined): 'success' | 'warning' | 'danger' {
  if (!r) return 'success';
  if (r.exceeded) return 'danger';
  if (r.approaching) return 'warning';
  return 'success';
}

export default function CompanyOverviewPage() {
  const locale = useLocale();
  const settings = useApiResource<CompanySettings>('/company-settings');
  const usage = useApiResource<UsageEvaluation>('/company-settings/usage');

  const loading = settings.loading || usage.loading;
  const company = settings.data;
  const evalData = usage.data;
  const res = (key: ResourceUsage['key']) => evalData?.resources.find((r) => r.key === key);

  return (
    <div>
      <PageHeader
        title={company ? company.name : 'Overview'}
        description="Your company's locations, screens, and plan usage."
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {!loading && (settings.error || usage.error) && (
        <EmptyState
          title="Could not load overview"
          description={settings.error ?? usage.error ?? undefined}
        />
      )}

      {!loading && company && evalData && (
        <div className="space-y-6">
          {evalData.status === 'grace' && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              A plan limit is exceeded — you are in a grace period
              {evalData.gracePeriodEndsAt
                ? ` ending ${new Date(evalData.gracePeriodEndsAt).toLocaleDateString()}`
                : ''}
              .
            </div>
          )}
          {evalData.status === 'blocked' && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              A plan limit is exceeded and the grace period has ended. Adding new resources is
              blocked — contact your administrator to upgrade the plan.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <UsageCard
              icon={Building2}
              label="Locations"
              resource={res('locations')}
              locale={locale}
            />
            <UsageCard icon={Monitor} label="Screens" resource={res('screens')} locale={locale} />
            <UsageCard icon={Users} label="Users" resource={res('users')} locale={locale} />
            <Card className="p-5">
              <p className="text-muted-foreground text-sm">Plan</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight">
                {company.plan?.name ?? 'No plan'}
              </p>
              {company.plan ? (
                <Badge tone="info" className="mt-2">
                  {company.plan.status}
                </Badge>
              ) : null}
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quick links</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { href: '/company/locations', label: 'Locations' },
                { href: '/company/screens', label: 'Screens' },
                { href: '/company/screen-groups', label: 'Screen Groups' },
                { href: '/company/tags', label: 'Tags' },
                { href: '/company/map', label: 'Map View' },
                { href: '/company/settings', label: 'Settings' },
                { href: '/company/activity-logs', label: 'Activity Logs' },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="border-border hover:bg-muted rounded-lg border px-4 py-3 text-sm font-medium transition"
                >
                  {l.label}
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function UsageCard({
  icon: Icon,
  label,
  resource,
  locale,
}: {
  icon: typeof Building2;
  label: string;
  resource: ResourceUsage | undefined;
  locale: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">{label}</p>
        <Icon className="text-muted-foreground size-4" aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{limitLabel(resource, locale)}</p>
      {resource && !resource.unlimited && resource.percentUsed !== null ? (
        <Badge tone={usageTone(resource)} className="mt-2">
          {formatNumber(resource.percentUsed, locale)}% used
        </Badge>
      ) : null}
    </Card>
  );
}
