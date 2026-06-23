'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { useApiResource } from '@/lib/use-api';
import { formatDateTime } from '@/lib/format';
import type { ActivityLogEntry, Paginated } from '@/lib/types';
import {
  Badge,
  EmptyState,
  Field,
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

/** Categories relevant to a company's own audit trail. */
const CATEGORIES = [
  'COMPANY',
  'USER',
  'SESSION',
  'INVITATION',
  'TWO_FACTOR',
  'AUTH',
  'SECURITY',
  'USAGE',
] as const;

const PAGE_SIZE = 25;

/** Shorten a long id (e.g. a UUID) for compact table display. */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Render an entry's target as "TYPE shortId", or a dash when absent. */
function formatTarget(entry: ActivityLogEntry): string {
  if (!entry.targetType && !entry.targetId) return '—';
  const type = entry.targetType ?? '';
  const id = entry.targetId ? shortId(entry.targetId) : '';
  return `${type} ${id}`.trim();
}

/** Compact, single-line preview of metadata for the cell footer. */
function metadataPreview(metadata: Record<string, unknown>): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const entries = Object.entries(metadata);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => {
      const rendered =
        value === null || typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${key}: ${rendered}`;
    })
    .join(' · ');
}

export default function CompanyActivityLogsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.activityLogs');
  const te = useTranslations('enums');

  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState('');

  // Debounce the free-text action filter so we don't refetch on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setAction(actionInput.trim()), 350);
    return () => clearTimeout(handle);
  }, [actionInput]);

  // Reset to the first page whenever a filter changes.
  useEffect(() => {
    setPage(1);
  }, [category, action]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (category) params.set('category', category);
    if (action) params.set('action', action);
    return `/activity-logs?${params.toString()}`;
  }, [page, category, action]);

  const { data, loading, error } = useApiResource<Paginated<ActivityLogEntry>>(path);

  const items = data?.items ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
        <Field label={t('category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('allCategories')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {te(`activityCategory.${c}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('action')}>
          <Input
            placeholder={t('actionPlaceholder')}
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
          />
        </Field>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title={t('loadError')} description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title={t('emptyTitle')}
          description={category || action ? t('emptyFiltered') : t('emptyDefault')}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('colTime')}</TH>
                <TH>{t('category')}</TH>
                <TH>{t('action')}</TH>
                <TH>{t('colTarget')}</TH>
                <TH>{t('colActor')}</TH>
                <TH>{t('colIp')}</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((entry) => {
                const meta = metadataPreview(entry.metadata);
                return (
                  <TR key={entry.id}>
                    <TD className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.createdAt, locale)}
                    </TD>
                    <TD>
                      <Badge>{entry.category}</Badge>
                    </TD>
                    <TD>
                      <div className="font-medium">{entry.action}</div>
                      {entry.description ? (
                        <div className="text-muted-foreground text-xs">{entry.description}</div>
                      ) : null}
                      {meta ? (
                        <div className="text-muted-foreground mt-0.5 max-w-md truncate font-mono text-xs">
                          {meta}
                        </div>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap">{formatTarget(entry)}</TD>
                    <TD className="text-muted-foreground whitespace-nowrap font-mono text-xs">
                      {entry.actorId ? shortId(entry.actorId) : t('systemActor')}
                    </TD>
                    <TD className="text-muted-foreground whitespace-nowrap">{entry.ip ?? '—'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
