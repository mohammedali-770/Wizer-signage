'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { useApiResource } from '@/lib/use-api';
import type { Paginated, PlaylistListItem, PlaylistStatus } from '@/lib/types';
import { formatDateTime } from '@/lib/format';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Table,
  TableSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';

const TABS: {
  labelKey: 'tabAll' | 'tabActive' | 'tabDraft' | 'tabArchived';
  value: '' | PlaylistStatus;
}[] = [
  { labelKey: 'tabAll', value: '' },
  { labelKey: 'tabActive', value: 'ACTIVE' },
  { labelKey: 'tabDraft', value: 'DRAFT' },
  { labelKey: 'tabArchived', value: 'ARCHIVED' },
];

const STATUS_TONE: Record<PlaylistStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

export default function PlaylistsPage() {
  const locale = useLocale();
  const t = useTranslations('pages.playlists');
  const tc = useTranslations('common');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'' | PlaylistStatus>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const path = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20', sort: 'updated' });
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    return `/playlists?${params.toString()}`;
  }, [page, status, search]);

  const { data, loading, error } = useApiResource<Paginated<PlaylistListItem>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/company/playlists/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" /> {t('newPlaylist')}
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
              {t(tab.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex flex-1 gap-2">
          <Input
            placeholder={t('searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          />
          <Button variant="outline" onClick={applySearch}>
            {tc('search')}
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <TableSkeleton rows={6} columns={4} />
      ) : error && !data ? (
        <EmptyState title={t('loadError')} description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('colTitle')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{tc('items')}</TH>
                <TH>{tc('updated')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((p) => (
                <TR key={p.id} className="cursor-pointer">
                  <TD>
                    <Link
                      href={`/company/playlists/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    {p.description ? (
                      <p className="text-muted-foreground line-clamp-1 text-xs">{p.description}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                  </TD>
                  <TD>{p.itemCount}</TD>
                  <TD className="text-muted-foreground">{formatDateTime(p.updatedAt, locale)}</TD>
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
