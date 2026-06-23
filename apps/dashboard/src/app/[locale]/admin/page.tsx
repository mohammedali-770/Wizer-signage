'use client';

import { useLocale, useTranslations } from 'next-intl';

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
  const t = useTranslations('pages.adminOverview');
  const { data, loading, error } = useApiResource<Overview>('/super-admin/overview');

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && <EmptyState title={t('loadError')} description={error} />}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={t('companies')} value={formatNumber(data.companies.total, locale)} />
            <StatCard
              label={t('activeSubscriptions')}
              value={formatNumber(data.subscriptions.byStatus.ACTIVE ?? 0, locale)}
              hint={t('totalHint', { value: formatNumber(data.subscriptions.total, locale) })}
            />
            <StatCard label={t('activePlans')} value={formatNumber(data.plans.active, locale)} />
            <StatCard
              label={t('unpaidInvoices')}
              value={formatNumber(data.invoices.unpaid, locale)}
              hint={t('outstandingHint', {
                value: formatCurrency(data.invoices.unpaidTotal, 'USD', locale),
              })}
            />
            <StatCard label={t('users')} value={formatNumber(data.users.total, locale)} />
            <StatCard
              label={t('activeSuperAdmins')}
              value={formatNumber(data.superAdmins.active, locale)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('companiesByStatus')}</CardTitle>
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
                <CardTitle>{t('subscriptionsByStatus')}</CardTitle>
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
