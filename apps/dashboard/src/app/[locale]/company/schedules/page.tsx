'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { useApiResource } from '@/lib/use-api';
import type { Paginated, Schedule, ScheduleStatus, ScheduleType } from '@/lib/types';
import { formatDate } from '@/lib/format';
import {
  Badge,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';

const TABS: { label: string; value: '' | ScheduleStatus }[] = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Paused', value: 'PAUSED' },
  { label: 'Archived', value: 'ARCHIVED' },
];

const STATUS_TONE: Record<ScheduleStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
};

export default function SchedulesPage() {
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | ScheduleStatus>('');
  const [type, setType] = useState<'' | ScheduleType>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const path = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20', sort: 'updated' });
    if (status) params.set('status', status);
    if (type) params.set('scheduleType', type);
    if (search) params.set('search', search);
    return `/schedules?${params.toString()}`;
  }, [page, status, type, search]);

  const { data, loading, error } = useApiResource<Paginated<Schedule>>(path);

  return (
    <div>
      <PageHeader
        title="Schedules"
        description="Decide what plays where and when, with priorities and campaigns."
        actions={
          <Link
            href="/company/schedules/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" /> New schedule
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="border-border flex gap-1 rounded-lg border p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value || 'all'}
              onClick={() => {
                setStatus(tab.value);
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                status === tab.value
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | ScheduleType);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">All types</option>
          <option value="NORMAL">Normal</option>
          <option value="CAMPAIGN">Campaign</option>
        </Select>
        <div className="flex flex-1 gap-2">
          <Input
            placeholder="Search schedules…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearch(searchInput.trim());
                setPage(1);
              }
            }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load schedules" description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Create a schedule to assign a playlist to screens."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH>Type</TH>
                <TH>Priority</TH>
                <TH>Playlist</TH>
                <TH>Targets</TH>
                <TH>Dates</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((s) => (
                <TR key={s.id}>
                  <TD>
                    <Link
                      href={`/company/schedules/${s.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={s.scheduleType === 'CAMPAIGN' ? 'info' : 'neutral'}>
                      {s.scheduleType}
                    </Badge>
                  </TD>
                  <TD>{s.priority}</TD>
                  <TD className="text-muted-foreground">{s.playlist?.title ?? '—'}</TD>
                  <TD>{s.targetCount}</TD>
                  <TD className="text-muted-foreground">
                    {s.startDate ? formatDate(s.startDate, locale) : '—'}
                    {s.endDate ? ` → ${formatDate(s.endDate, locale)}` : ''}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
