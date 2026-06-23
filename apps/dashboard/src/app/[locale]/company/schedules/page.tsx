'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';

const TABS: { tkey: 'all' | 'active' | 'paused' | 'archived'; value: '' | ScheduleStatus }[] = [
  { tkey: 'all', value: '' },
  { tkey: 'active', value: 'ACTIVE' },
  { tkey: 'paused', value: 'PAUSED' },
  { tkey: 'archived', value: 'ARCHIVED' },
];

const STATUS_TONE: Record<ScheduleStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
};

export default function SchedulesPage() {
  const locale = useLocale();
  const t = useTranslations('pages.schedules');
  const tc = useTranslations('common');
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
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/company/schedules/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" /> {t('newSchedule')}
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
              {t(`tabs.${tab.tkey}`)}
            </button>
          ))}
        </div>
        <Select
          aria-label={t('filterByType')}
          value={type}
          onChange={(e) => {
            setType(e.target.value as '' | ScheduleType);
            setPage(1);
          }}
          className="w-40"
        >
          <option value="">{t('allTypes')}</option>
          <option value="NORMAL">{t('typeNormal')}</option>
          <option value="CAMPAIGN">{t('typeCampaign')}</option>
        </Select>
        <div className="flex flex-1 gap-2">
          <Input
            aria-label={tc('search')}
            placeholder={t('searchPlaceholder')}
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

      {loading && !data ? (
        <TableSkeleton rows={6} columns={5} />
      ) : error && !data ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{tc('type')}</TH>
                <TH>{t('priority')}</TH>
                <TH>{t('playlist')}</TH>
                <TH>{t('targets')}</TH>
                <TH>{t('dates')}</TH>
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
