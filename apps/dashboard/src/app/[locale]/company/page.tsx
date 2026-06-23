'use client';

import { useLocale } from 'next-intl';
import {
  Building2,
  CalendarClock,
  ListVideo,
  Monitor,
  MonitorPlay,
  Plus,
  Upload,
  Users,
} from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import type {
  CompanySettings,
  MonitoringOverview,
  ResourceUsage,
  UsageEvaluation,
} from '@/lib/types';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Skeleton,
  StatCardSkeleton,
} from '@/components/ui';
import { Link } from '@/i18n/navigation';

const QUICK_ACTIONS = [
  { href: '/company/screens/new', label: 'Add screen', icon: Plus, primary: true },
  { href: '/company/content/new', label: 'Upload content', icon: Upload },
  { href: '/company/playlists/new', label: 'Create playlist', icon: ListVideo },
  { href: '/company/schedules/new', label: 'Create schedule', icon: CalendarClock },
];

const QUICK_LINKS = [
  { href: '/company/locations', label: 'Locations' },
  { href: '/company/screens', label: 'Screens' },
  { href: '/company/screen-groups', label: 'Screen Groups' },
  { href: '/company/tags', label: 'Tags' },
  { href: '/company/map', label: 'Map View' },
  { href: '/company/settings', label: 'Settings' },
  { href: '/company/activity-logs', label: 'Activity Logs' },
];

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
  // Two independent sources — render each as soon as it arrives instead of
  // blocking the whole page on the slower one.
  const settings = useApiResource<CompanySettings>('/company-settings');
  const usage = useApiResource<UsageEvaluation>('/company-settings/usage');
  const fleet = useApiResource<MonitoringOverview>('/monitoring/overview');

  const company = settings.data;
  const evalData = usage.data;
  const totals = fleet.data?.totals;
  const res = (key: ResourceUsage['key']) => evalData?.resources.find((r) => r.key === key);

  return (
    <div>
      <PageHeader
        title={company ? company.name : 'Overview'}
        description="Your company's locations, screens, and plan usage."
      />

      {/* Quick actions — guide users straight into the common create flows. */}
      <div className="mb-6 flex flex-wrap gap-2">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href}
              href={a.href}
              className={cn(
                'focus-visible:ring-primary/40 inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2',
                a.primary
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'border-border hover:bg-muted border',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {a.label}
            </Link>
          );
        })}
      </div>

      <div className="space-y-6">
        {/* Fleet health — instant visibility of screen status (Req 4). */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>Fleet health</CardTitle>
            <Link
              href="/company/monitoring"
              className="text-primary text-xs font-medium hover:underline"
            >
              View monitoring →
            </Link>
          </CardHeader>
          <CardContent>
            {fleet.error ? (
              <p className="text-muted-foreground text-sm">Could not load fleet status.</p>
            ) : !totals ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : totals.total === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">
                  No screens yet. Add a screen and pair your Android TV to get started.
                </p>
                <Link
                  href="/company/screens/new"
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Add your first screen →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <FleetStat label="Online" value={totals.online} tone="success" icon={MonitorPlay} />
                <FleetStat label="Offline" value={totals.offline} tone="danger" icon={Monitor} />
                <FleetStat label="Warning" value={totals.warning} tone="warning" icon={Monitor} />
                <FleetStat
                  label="Unpaired"
                  value={totals.unpaired + totals.pairing}
                  tone="info"
                  icon={Monitor}
                />
              </div>
            )}
          </CardContent>
        </Card>
        {evalData?.status === 'grace' && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            A plan limit is exceeded — you are in a grace period
            {evalData.gracePeriodEndsAt
              ? ` ending ${new Date(evalData.gracePeriodEndsAt).toLocaleDateString()}`
              : ''}
            .
          </div>
        )}
        {evalData?.status === 'blocked' && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            A plan limit is exceeded and the grace period has ended. Adding new resources is blocked
            — contact your administrator to upgrade the plan.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {usage.error ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <EmptyState title="Could not load usage" description={usage.error} />
            </div>
          ) : evalData ? (
            <>
              <UsageCard
                icon={Building2}
                label="Locations"
                resource={res('locations')}
                locale={locale}
              />
              <UsageCard icon={Monitor} label="Screens" resource={res('screens')} locale={locale} />
              <UsageCard icon={Users} label="Users" resource={res('users')} locale={locale} />
            </>
          ) : (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          )}

          {/* Plan card depends on settings, which loads independently of usage. */}
          {company ? (
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
          ) : settings.error ? (
            <Card className="p-5">
              <p className="text-muted-foreground text-sm">Plan</p>
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">Unavailable</p>
            </Card>
          ) : (
            <StatCardSkeleton />
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Quick links</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUICK_LINKS.map((l) => (
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
    </div>
  );
}

const FLEET_TONES: Record<'success' | 'danger' | 'warning' | 'info', string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-blue-600 dark:text-blue-400',
};

function FleetStat({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: keyof typeof FLEET_TONES;
  icon: typeof Monitor;
}) {
  return (
    <div className="border-border rounded-lg border p-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Icon className={cn('size-3.5', FLEET_TONES[tone])} aria-hidden />
        {label}
      </div>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', FLEET_TONES[tone])}>{value}</p>
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
