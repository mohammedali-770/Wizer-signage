'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Search } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { formatDate, formatNumber } from '@/lib/format';
import type { LocationListItem, LocationStatus, Paginated } from '@/lib/types';
import { Link } from '@/i18n/navigation';
import {
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: LocationStatus[] = ['ACTIVE', 'INACTIVE', 'ARCHIVED'];

export default function LocationsPage() {
  const locale = useLocale();

  // Applied (committed) query state that drives the request.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | LocationStatus>('');

  // Pending search input (committed on Enter / button click).
  const [searchInput, setSearchInput] = useState('');

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    params.set('sort', 'createdAt');
    params.set('order', 'desc');
    return `/locations?${params.toString()}`;
  }, [page, search, status]);

  const { data, loading, error } = useApiResource<Paginated<LocationListItem>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const onStatusChange = (value: string) => {
    setStatus(value as '' | LocationStatus);
    setPage(1);
  };

  const items = data?.items ?? [];
  const meta = data?.meta;
  const hasFilters = !!(search || status);

  return (
    <div>
      <PageHeader
        title="Locations"
        description="Sites where your screens are deployed."
        actions={
          <Link
            href="/company/locations/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" />
            New Location
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or code…"
              className="pl-9"
              aria-label="Search locations"
            />
          </div>
        </form>

        <Select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-44"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load locations" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No locations found"
          description={
            hasFilters
              ? 'Try adjusting your search or status filter.'
              : 'Create your first location to get started.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Code</TH>
                <TH>City</TH>
                <TH>Status</TH>
                <TH className="text-right">Screens</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((location) => (
                <TR key={location.id}>
                  <TD>
                    <Link
                      href={`/company/locations/${location.id}`}
                      className="text-foreground hover:text-primary font-medium hover:underline"
                    >
                      {location.name}
                    </Link>
                  </TD>
                  <TD className="text-muted-foreground">
                    {location.code ? (
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                        {location.code}
                      </code>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD className="text-muted-foreground">{location.city ?? '—'}</TD>
                  <TD>
                    <StatusBadge status={location.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatNumber(location.screenCount, locale)}
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDate(location.createdAt, locale)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />}
        </>
      )}
    </div>
  );
}
