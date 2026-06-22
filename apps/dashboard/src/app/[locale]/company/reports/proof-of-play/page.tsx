'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Download } from 'lucide-react';

import { getAccessToken } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  Paginated,
  ProofOfPlayEvent,
  ProofOfPlayStatus,
  ProofOfPlaySummary,
  Screen,
} from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatCard,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@/components/ui';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const STATUS_TONE: Record<
  ProofOfPlayStatus,
  'success' | 'danger' | 'warning' | 'info' | 'neutral'
> = {
  COMPLETED: 'success',
  FAILED: 'danger',
  SKIPPED: 'warning',
  INTERRUPTED: 'info',
  STARTED: 'neutral',
};

function durationLabel(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function ProofOfPlayReportPage() {
  const locale = useLocale();
  const { toast } = useToast();
  const screens = useApiResource<Paginated<Screen>>('/screens?pageSize=100');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [screenId, setScreenId] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set('to', new Date(`${to}T23:59:59`).toISOString());
    if (status) p.set('status', status);
    if (sourceType) p.set('sourceType', sourceType);
    if (screenId) p.set('screenId', screenId);
    return p.toString();
  }, [from, to, status, sourceType, screenId]);

  const summary = useApiResource<ProofOfPlaySummary>(
    `/proof-of-play/summary${query ? `?${query}` : ''}`,
  );
  const report = useApiResource<Paginated<ProofOfPlayEvent>>(
    `/proof-of-play?page=${page}&pageSize=25${query ? `&${query}` : ''}`,
  );

  const onFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`${BASE}/proof-of-play/export.csv${query ? `?${query}` : ''}`, {
        headers: { authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'proof-of-play.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not export CSV.', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Proof of Play"
        description="Actual playback events reported by your screens — not heartbeat or sync status."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={exporting}>
            <Download className="size-4" /> {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        }
      />

      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => onFilter(setFrom)(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => onFilter(setTo)(e.target.value)} />
        </Field>
        <Field label="Screen">
          <Select value={screenId} onChange={(e) => onFilter(setScreenId)(e.target.value)}>
            <option value="">All screens</option>
            {screens.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => onFilter(setStatus)(e.target.value)}>
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="SKIPPED">Skipped</option>
            <option value="INTERRUPTED">Interrupted</option>
            <option value="STARTED">Started</option>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={sourceType} onChange={(e) => onFilter(setSourceType)(e.target.value)}>
            <option value="">All</option>
            <option value="SCHEDULE">Schedule</option>
            <option value="FALLBACK">Fallback</option>
            <option value="EMERGENCY">Emergency</option>
            <option value="NONE">None</option>
          </Select>
        </Field>
      </Card>

      {summary.data ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total plays" value={summary.data.totalPlays} />
          <StatCard label="Completed" value={summary.data.completedPlays} />
          <StatCard label="Failed" value={summary.data.failedPlays} />
          <StatCard label="Skipped" value={summary.data.skippedPlays} />
          <StatCard label="Interrupted" value={summary.data.interruptedPlays} />
          <StatCard
            label="Total duration"
            value={`${Math.round(summary.data.totalDurationMs / 1000)}s`}
          />
        </div>
      ) : null}

      {report.loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : report.error ? (
        <EmptyState title="Could not load report" description={report.error} />
      ) : !report.data || report.data.items.length === 0 ? (
        <EmptyState
          title="No playback events"
          description="Once paired screens start playing content, their proof-of-play events appear here."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Screen</TH>
                <TH>Content</TH>
                <TH>Source</TH>
                <TH>Status</TH>
                <TH>Duration</TH>
                <TH>Net</TH>
              </TR>
            </THead>
            <TBody>
              {report.data.items.map((e) => (
                <TR key={e.id}>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDateTime(e.startedAt, locale)}
                  </TD>
                  <TD>
                    {e.screenName ?? e.screenId}
                    {e.locationName ? (
                      <p className="text-muted-foreground text-xs">{e.locationName}</p>
                    ) : null}
                  </TD>
                  <TD>
                    {e.emergencyBroadcastTitle ? (
                      <span className="font-medium text-red-600">
                        ⚠ {e.emergencyBroadcastTitle}
                      </span>
                    ) : (
                      (e.contentTitle ?? '—')
                    )}
                    {e.failureReason ? (
                      <p className="text-xs text-red-600">{e.failureReason}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <span className="text-muted-foreground text-xs">
                      {e.sourceType} · {e.playbackSource}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">{durationLabel(e.durationMs)}</TD>
                  <TD className="text-muted-foreground">
                    {e.offlinePlayback ? 'Offline' : 'Online'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="mt-4">
            <Pagination
              page={report.data.meta.page}
              totalPages={report.data.meta.totalPages}
              onPage={setPage}
            />
          </div>
        </>
      )}

      {summary.data && summary.data.mostPlayedContent.length > 0 ? (
        <Card className="mt-6 p-4">
          <p className="mb-2 text-sm font-semibold">Most played content</p>
          <ul className="space-y-1 text-sm">
            {summary.data.mostPlayedContent.map((c) => (
              <li key={c.contentId ?? 'unknown'} className="flex justify-between">
                <span>{c.title ?? c.contentId ?? 'Unknown'}</span>
                <span className="text-muted-foreground">{c.plays} plays</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
