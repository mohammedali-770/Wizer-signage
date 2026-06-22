'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
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
  Spinner,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';

const TABS: { label: string; value: '' | PlaylistStatus }[] = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Archived', value: 'ARCHIVED' },
];

const STATUS_TONE: Record<PlaylistStatus, 'success' | 'neutral' | 'warning'> = {
  ACTIVE: 'success',
  DRAFT: 'neutral',
  ARCHIVED: 'warning',
};

export default function PlaylistsPage() {
  const locale = useLocale();
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
        title="Playlists"
        description="Sequence ready-made content for your screens."
        actions={
          <Link
            href="/company/playlists/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" /> New playlist
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
        <div className="flex flex-1 gap-2">
          <Input
            placeholder="Search playlists…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applySearch()}
          />
          <Button variant="outline" onClick={applySearch}>
            Search
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      ) : error ? (
        <EmptyState title="Could not load playlists" description={error} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          description="Create a playlist to start sequencing content."
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Status</TH>
                <TH>Items</TH>
                <TH>Updated</TH>
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
