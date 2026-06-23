'use client';

import { useTranslations } from 'next-intl';
import { CreditCard, Database, Lock, ServerCog, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from '@/components/ui';

type SettingRow = { label: string; value: string };

function SettingList({ rows }: { rows: SettingRow[] }) {
  return (
    <dl className="divide-border divide-y">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
        >
          <dt className="text-foreground text-sm font-medium sm:w-1/3 sm:shrink-0">{row.label}</dt>
          <dd className="text-muted-foreground text-sm sm:flex-1 sm:text-end">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SettingsCard({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  rows: SettingRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="text-muted-foreground size-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SettingList rows={rows} />
      </CardContent>
    </Card>
  );
}

export default function SystemSettingsPage() {
  const t = useTranslations('pages.adminSettings');

  const PLATFORM_ROWS: SettingRow[] = [
    { label: t('platformProduct'), value: 'MasterSignage' },
    { label: t('platformConsole'), value: t('platformConsoleValue') },
    { label: t('platformPhase'), value: t('platformPhaseValue') },
    { label: t('platformConfigSource'), value: t('platformConfigSourceValue') },
  ];

  const SECURITY_ROWS: SettingRow[] = [
    { label: t('securityPasswordPolicy'), value: t('securityPasswordPolicyValue') },
    { label: t('securityLockout'), value: t('securityLockoutValue') },
    { label: t('securityTwoFactor'), value: t('securityTwoFactorValue') },
    { label: t('securitySessionTimeout'), value: t('securitySessionTimeoutValue') },
  ];

  const RETENTION_ROWS: SettingRow[] = [
    { label: t('retentionActivityLogs'), value: t('retentionDefaultValue') },
    { label: t('retentionProofOfPlay'), value: t('retentionDefaultValue') },
    { label: t('retentionScreenshots'), value: t('retentionDefaultValue') },
    { label: t('retentionFinancial'), value: t('retentionFinancialValue') },
  ];

  const BILLING_ROWS: SettingRow[] = [
    { label: t('billingGateway'), value: t('billingGatewayValue') },
    { label: t('billingInvoicing'), value: t('billingInvoicingValue') },
    { label: t('billingCurrency'), value: 'USD' },
    { label: t('billingIntervals'), value: t('billingIntervalsValue') },
  ];

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SettingsCard title={t('platform')} icon={ServerCog} rows={PLATFORM_ROWS} />
          <SettingsCard title={t('security')} icon={ShieldCheck} rows={SECURITY_ROWS} />
          <SettingsCard title={t('dataRetention')} icon={Database} rows={RETENTION_ROWS} />
          <SettingsCard title={t('billing')} icon={CreditCard} rows={BILLING_ROWS} />
        </div>

        <Card className="bg-muted/20 border-dashed">
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Lock className="size-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{t('readOnlyTitle')}</p>
              <p className="text-muted-foreground mt-1 text-sm">{t('readOnlyBody')}</p>
            </div>
          </CardContent>
        </Card>

        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      </div>
    </div>
  );
}
