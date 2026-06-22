'use client';

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
          <dd className="text-muted-foreground text-sm sm:flex-1 sm:text-right">{row.value}</dd>
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

const PLATFORM_ROWS: SettingRow[] = [
  { label: 'Product', value: 'MasterSignage' },
  { label: 'Console', value: 'Super Admin' },
  { label: 'Release phase', value: 'Phase 2' },
  {
    label: 'Configuration source',
    value: 'Managed via environment variables and deployment pipeline',
  },
];

const SECURITY_ROWS: SettingRow[] = [
  { label: 'Password policy', value: 'Minimum 10 characters with complexity requirements' },
  { label: 'Account lockout', value: '7 failed attempts, locked for 15 minutes' },
  { label: 'Two-factor authentication', value: 'Required for all Super Admins' },
  { label: 'Session timeout', value: '30 minutes of inactivity' },
];

const RETENTION_ROWS: SettingRow[] = [
  { label: 'Activity logs', value: '90 days (default)' },
  { label: 'Proof-of-play records', value: '90 days (default)' },
  { label: 'Player screenshots', value: '90 days (default)' },
  { label: 'Financial records', value: 'Retained longer for compliance' },
];

const BILLING_ROWS: SettingRow[] = [
  { label: 'Payment gateway', value: 'Not integrated in v1' },
  { label: 'Invoicing', value: 'Manual invoices managed by Super Admins' },
  { label: 'Default currency', value: 'USD' },
  { label: 'Billing intervals', value: 'Monthly, Quarterly, Yearly' },
];

export default function SystemSettingsPage() {
  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Platform configuration overview. In this phase these settings are read-only and managed through environment and deployment."
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SettingsCard title="Platform" icon={ServerCog} rows={PLATFORM_ROWS} />
          <SettingsCard title="Security" icon={ShieldCheck} rows={SECURITY_ROWS} />
          <SettingsCard title="Data retention" icon={Database} rows={RETENTION_ROWS} />
          <SettingsCard title="Billing" icon={CreditCard} rows={BILLING_ROWS} />
        </div>

        <Card className="bg-muted/20 border-dashed">
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
              <Lock className="size-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">These settings are read-only in this phase</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Platform configuration is currently managed through environment variables and the
                deployment pipeline. In-app editable settings will arrive in a later phase.
              </p>
            </div>
          </CardContent>
        </Card>

        <EmptyState
          title="No editable settings yet"
          description="Configuration controls for this console are coming in a future release."
        />
      </div>
    </div>
  );
}
