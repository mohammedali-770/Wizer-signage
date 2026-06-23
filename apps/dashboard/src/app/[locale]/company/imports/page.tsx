'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';

import { api, ApiError, getAccessToken } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { ImportJob, ImportType, Paginated } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const TYPES: ImportType[] = ['LOCATION', 'SCREEN', 'SCREEN_GROUP', 'TAG', 'USER'];
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  UPLOADED: 'neutral',
  VALIDATED: 'info',
  COMMITTED: 'success',
  FAILED: 'danger',
  CANCELLED: 'warning',
};

export default function ImportsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.imports');
  const tc = useTranslations('common');
  const te = useTranslations('enums');
  const { toast } = useToast();
  const [type, setType] = useState<ImportType>('LOCATION');
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useApiResource<Paginated<ImportJob>>('/imports?pageSize=20');

  const downloadTemplate = async () => {
    try {
      const res = await fetch(`${BASE}/imports/templates/${type}`, {
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type.toLowerCase()}-template.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast(t('toast.templateFailed'), 'error');
    }
  };

  const upload = async () => {
    if (!file) return toast(t('toast.chooseFile'), 'error');
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api.upload<ImportJob>(`/imports?type=${type}`, form);
      setJob(result);
      toast(t('toast.validated', { total: result.totalRows, valid: result.validRows }), 'success');
      history.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.uploadFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const result = await api.post<ImportJob & { committed: number; failed: number }>(
        `/imports/${job.id}/commit`,
      );
      toast(
        result.failed
          ? t('toast.importedWithFailures', {
              committed: result.committed,
              failed: result.failed,
            })
          : t('toast.imported', { committed: result.committed }),
        result.failed ? 'info' : 'success',
      );
      setJob(result);
      history.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t('toast.commitFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('newImport')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={tc('type')}>
              <Select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as ImportType);
                  setJob(null);
                }}
              >
                {TYPES.map((it) => (
                  <option key={it} value={it}>
                    {te('importType.' + it)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="outline" onClick={downloadTemplate}>
              <Download className="size-4" /> {t('template')}
            </Button>
          </div>

          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setJob(null);
            }}
            className="block text-sm"
          />

          <div className="flex gap-2">
            <Button onClick={upload} disabled={busy || !file}>
              {busy ? (
                <Spinner className="size-4" />
              ) : (
                <>
                  <Upload className="size-4" /> {t('validate')}
                </>
              )}
            </Button>
            {job && job.status === 'VALIDATED' && job.validRows > 0 ? (
              <Button onClick={commit} disabled={busy}>
                {t('commitRows', { count: job.validRows })}
              </Button>
            ) : null}
          </div>

          {job ? (
            <div className="border-border rounded-md border p-3 text-sm">
              <div className="flex flex-wrap gap-4">
                <span>
                  {t('summary.total')}: <b>{job.totalRows}</b>
                </span>
                <span className="text-green-600">
                  {t('summary.valid')}: <b>{job.validRows}</b>
                </span>
                <span className="text-red-600">
                  {t('summary.invalid')}: <b>{job.invalidRows}</b>
                </span>
                <Badge tone={STATUS_TONE[job.status] ?? 'neutral'}>{job.status}</Badge>
              </div>
              {Array.isArray(job.errors) && job.errors.length > 0 ? (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-red-600">
                  {job.errors.slice(0, 50).map((e, i) => (
                    <li key={i}>
                      {t('rowLabel', { line: e.line })}: {e.errors.join('; ')}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <h2 className="mb-2 text-sm font-semibold">{t('history')}</h2>
      {history.loading ? (
        <Spinner className="text-primary size-5" />
      ) : !history.data || history.data.items.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>{t('columns.when')}</TH>
              <TH>{tc('type')}</TH>
              <TH>{t('columns.file')}</TH>
              <TH>{t('columns.rows')}</TH>
              <TH>{tc('status')}</TH>
            </TR>
          </THead>
          <TBody>
            {history.data.items.map((j) => (
              <TR key={j.id}>
                <TD className="text-muted-foreground">{formatDateTime(j.createdAt, locale)}</TD>
                <TD>{te('importType.' + j.type)}</TD>
                <TD className="text-muted-foreground">{j.fileName}</TD>
                <TD className="text-muted-foreground">
                  {j.validRows}/{j.totalRows}
                </TD>
                <TD>
                  <Badge tone={STATUS_TONE[j.status] ?? 'neutral'}>{j.status}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
