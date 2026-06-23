'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.scheduledReports');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
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
    if (!name.trim()) return toast(t('toast.nameRequired'), 'error');
    if (emails.length === 0) return toast(t('toast.recipientRequired'), 'error');
    setBusy('create');
    try {
      await api.post('/scheduled-reports', {
        name: name.trim(),
        reportType,
        format,
        frequency,
        recipients: emails,
      });
      toast(t('toast.created'), 'success');
      setOpen(false);
      setName('');
      setRecipients('');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.createFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const act = async (id: string, path: string, method: 'post' | 'del', label: string) => {
    setBusy(id + path);
    try {
      if (method === 'del') await api.del(`/scheduled-reports/${id}`);
      else await api.post(`/scheduled-reports/${id}/${path}`);
      toast(t('toast.actionDone', { action: label }), 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.actionFailed'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" /> {t('new')}
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{tc('name')}</TH>
              <TH>{t('columns.report')}</TH>
              <TH>{t('columns.format')}</TH>
              <TH>{t('columns.frequency')}</TH>
              <TH>{t('columns.nextRun')}</TH>
              <TH>{tc('status')}</TH>
              <TH>{tc('actions')}</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium">{r.name}</TD>
                <TD className="text-muted-foreground">{te('reportType.' + r.reportType)}</TD>
                <TD className="text-muted-foreground">{r.format}</TD>
                <TD className="text-muted-foreground">{t('frequencies.' + r.frequency)}</TD>
                <TD className="text-muted-foreground">
                  {r.nextRunAt ? formatDateTime(r.nextRunAt, locale) : '—'}
                </TD>
                <TD>
                  <Badge tone={r.enabled ? 'success' : 'neutral'}>
                    {r.enabled ? t('status.enabled') : t('status.disabled')}
                  </Badge>
                </TD>
                <TD>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id + 'run'}
                      onClick={() => act(r.id, 'run', 'post', t('actions.run'))}
                    >
                      {t('actions.runNow')}
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
                          r.enabled ? t('actions.disable') : t('actions.enable'),
                        )
                      }
                    >
                      {r.enabled ? t('actions.disable') : t('actions.enable')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy === r.id + 'del'}
                      onClick={() => act(r.id, '', 'del', t('actions.delete'))}
                    >
                      {tc('delete')}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title={t('dialog.title')}>
        <div className="space-y-3">
          <Field label={tc('name')}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              placeholder={t('dialog.namePlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('columns.report')}>
              <Select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
              >
                {REPORT_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {te('reportType.' + rt)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('columns.format')}>
              <Select value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('columns.frequency')}>
            <Select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {t('frequencies.' + f)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('dialog.recipients')} hint={t('dialog.recipientsHint')}>
            <Input
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={t('dialog.recipientsPlaceholder')}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy === 'create'}>
              {tc('cancel')}
            </Button>
            <Button onClick={create} disabled={busy === 'create'}>
              {busy === 'create' ? <Spinner className="size-4" /> : tc('create')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
