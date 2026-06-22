'use client';

import { useLocale } from 'next-intl';

import { useApiResource } from '@/lib/use-api';
import { formatCurrency, formatNumber } from '@/lib/format';
import type { Overview } from '@/lib/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
  StatusBadge,
} from '@/components/ui';

export default function OverviewPage() {
  const locale = useLocale();
  const { data, loading, error } = useApiResource<Overview>('/super-admin/overview');

  return (
    <div>
      <PageHeader title="Overview" description="Platform-wide metrics across all tenants." />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && <EmptyState title="Could not load overview" description={error} />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Companies" value={formatNumber(data.companies.total, locale)} />
            <StatCard
              label="Active subscriptions"
              value={formatNumber(data.subscriptions.byStatus.ACTIVE ?? 0, locale)}
              hint={`${formatNumber(data.subscriptions.total, locale)} total`}
            />
            <StatCard label="Active plans" value={formatNumber(data.plans.active, locale)} />
            <StatCard
              label="Unpaid invoices"
              value={formatNumber(data.invoices.unpaid, locale)}
              hint={`${formatCurrency(data.invoices.unpaidTotal, 'USD', locale)} outstanding`}
            />
            <StatCard label="Users" value={formatNumber(data.users.total, locale)} />
            <StatCard
              label="Active Super Admins"
              value={formatNumber(data.superAdmins.active, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Companies by status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.companies.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <StatusBadge status={status} />
                    <span className="text-sm font-medium">{formatNumber(count, locale)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Subscriptions by status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.subscriptions.byStatus).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between">
                    <StatusBadge status={status} />
                    <span className="text-sm font-medium">{formatNumber(count, locale)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
