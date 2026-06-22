'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  Paginated,
  ReportFormat,
  ReportFrequency,
  ReportType,
  ScheduledReport,
} from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

const REPORT_TYPES: ReportType[] = [
  'PROOF_OF_PLAY',
  'SCREEN_HEALTH',
  'ALERTS',
  'ACTIVITY_LOGS',
  'BILLING',
];
const FORMATS: ReportFormat[] = ['CSV', 'XLSX', 'PDF'];
const FREQUENCIES: ReportFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export default function ScheduledReportsPage() {
  const locale = useLocale();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<Paginated<ScheduledReport>>(
    '/scheduled-reports?pageSize=50',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState('');
  const [reportType, setReportType] = useState<ReportType>('PROOF_OF_PLAY');
  const [format, setFormat] = useState<ReportFormat>('CSV');
  const [frequency, setFrequency] = useState<ReportFrequency>('WEEKLY');
  const [recipients, setRecipients] = useState('');

  const create = async () => {
    const emails = recipients
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (!name.trim()) return toast('A name is required.', 'error');
    if (emails.length === 0) return toast('Add at least one recipient email.', 'error');
    setBusy('create');
    try {
      await api.post('/scheduled-reports', {
        name: name.trim(),
        reportType,
        format,
        frequency,
        recipients: emails,
      });
      toast('Scheduled report created.', 'success');
      setOpen(false);
      setName('');
      setRecipients('');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create report.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, path: string, method: 'post' | 'del', label: string) => {
    setBusy(id + path);
    try {
      if (method === 'del') await api.del(`/scheduled-reports/${id}`);
      else await api.post(`/scheduled-reports/${id}/${path}`);
      toast(`${label} done.`, 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Action failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Scheduled Reports"
        description="Email proof-of-play, screen-health, alerts, activity-log, and billing reports on a schedule."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> New scheduled report
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load reports" description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No scheduled reports"
          description="Create one to receive recurring reports by email."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Report</TH>
              <TH>Format</TH>
              <TH>Frequency</TH>
              <TH>Next run</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="text-muted-foreground">{r.reportType}</TD>
                <TD className="text-muted-foreground">{r.format}</TD>
                <TD className="text-muted-foreground">{r.frequency}</TD>
                <TD className="text-muted-foreground">
                  {r.nextRunAt ? formatDateTime(r.nextRunAt, locale) : '—'}
                </TD>
                <TD>
                  <Badge tone={r.enabled ? 'success' : 'neutral'}>
                    {r.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </TD>
                <TD>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id + 'run'}
                      onClick={() => act(r.id, 'run', 'post', 'Run')}
                    >
                      Run now
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id + (r.enabled ? 'disable' : 'enable')}
                      onClick={() =>
                        act(
                          r.id,
                          r.enabled ? 'disable' : 'enable',
                          'post',
                          r.enabled ? 'Disable' : 'Enable',
                        )
                      }
                    >
                      {r.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id + 'del'}
                      onClick={() => act(r.id, '', 'del', 'Delete')}
                    >
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New scheduled report">
        <div className="space-y-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              placeholder="Weekly proof-of-play"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Report">
              <Select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Format">
              <Select value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Frequency">
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Recipients" hint="Comma-separated email addresses.">
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="ops@example.com, manager@example.com"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy === 'create'}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy === 'create'}>
              {busy === 'create' ? <Spinner className="size-4" /> : 'Create'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
