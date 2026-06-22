'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Search } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { formatDate } from '@/lib/format';
import type {
  LocationListItem,
  Orientation,
  Paginated,
  Screen,
  ScreenStatus,
  ScreenUse,
  Tag,
} from '@/lib/types';
import { Link } from '@/i18n/navigation';
import {
  Badge,
  Button,
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

const STATUS_OPTIONS: ScreenStatus[] = [
  'UNPAIRED',
  'PAIRING',
  'ONLINE',
  'OFFLINE',
  'WARNING',
  'DISABLED',
  'ARCHIVED',
];

const ORIENTATION_OPTIONS: Orientation[] = ['LANDSCAPE', 'PORTRAIT', 'UNKNOWN'];

const USE_OPTIONS: ScreenUse[] = [
  'MENU_LANDSCAPE',
  'OFFERS_PORTRAIT',
  'WAITING_AREA',
  'CASHIER_DISPLAY',
  'ENTRANCE',
  'INDOOR',
  'OUTDOOR',
  'GENERIC',
];

const USE_LABELS: Record<ScreenUse, string> = {
  MENU_LANDSCAPE: 'Menu (Landscape)',
  OFFERS_PORTRAIT: 'Offers (Portrait)',
  WAITING_AREA: 'Waiting Area',
  CASHIER_DISPLAY: 'Cashier Display',
  ENTRANCE: 'Entrance',
  INDOOR: 'Indoor',
  OUTDOOR: 'Outdoor',
  GENERIC: 'Generic/Custom',
};

const ORIENTATION_LABELS: Record<Orientation, string> = {
  LANDSCAPE: 'Landscape',
  PORTRAIT: 'Portrait',
  UNKNOWN: 'Unknown',
};

function screenUseLabel(use: ScreenUse | null): string {
  return use ? USE_LABELS[use] : '—';
}

export default function ScreensPage() {
  const locale = useLocale();

  // Applied (committed) query state that drives the request.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState<'' | ScreenStatus>('');
  const [orientation, setOrientation] = useState<'' | Orientation>('');
  const [use, setUse] = useState<'' | ScreenUse>('');
  const [tagId, setTagId] = useState('');

  // Pending search input (committed on Enter / button click).
  const [searchInput, setSearchInput] = useState('');

  const locations = useApiResource<Paginated<LocationListItem>>('/locations?pageSize=100');
  const tags = useApiResource<Paginated<Tag>>('/tags?pageSize=100');

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (search) params.set('search', search);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    if (orientation) params.set('orientation', orientation);
    if (use) params.set('use', use);
    if (tagId) params.set('tagId', tagId);
    params.set('sort', 'createdAt');
    params.set('order', 'desc');
    return `/screens?${params.toString()}`;
  }, [page, search, locationId, status, orientation, use, tagId]);

  const { data, loading, error } = useApiResource<Paginated<Screen>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const resetPage = () => setPage(1);

  const items = data?.items ?? [];
  const meta = data?.meta;
  const hasFilters = !!(search || locationId || status || orientation || use || tagId);

  return (
    <div>
      <PageHeader
        title="Screens"
        description="Displays paired and managed across your locations."
        actions={
          <Link
            href="/company/screens/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" />
            New Screen
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
              aria-label="Search screens"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <Select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            resetPage();
          }}
          className="w-44"
          aria-label="Filter by location"
        >
          <option value="">All locations</option>
          {(locations.data?.items ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>

        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | ScreenStatus);
            resetPage();
          }}
          className="w-40"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <Select
          value={orientation}
          onChange={(e) => {
            setOrientation(e.target.value as '' | Orientation);
            resetPage();
          }}
          className="w-40"
          aria-label="Filter by orientation"
        >
          <option value="">All orientations</option>
          {ORIENTATION_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {ORIENTATION_LABELS[o]}
            </option>
          ))}
        </Select>

        <Select
          value={use}
          onChange={(e) => {
            setUse(e.target.value as '' | ScreenUse);
            resetPage();
          }}
          className="w-44"
          aria-label="Filter by use"
        >
          <option value="">All uses</option>
          {USE_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {USE_LABELS[u]}
            </option>
          ))}
        </Select>

        <Select
          value={tagId}
          onChange={(e) => {
            setTagId(e.target.value);
            resetPage();
          }}
          className="w-40"
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {(tags.data?.items ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {!loading && error && <EmptyState title="Could not load screens" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No screens found"
          description={
            hasFilters
              ? 'Try adjusting your search or filters.'
              : 'Create your first screen to get started.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Location</TH>
                <TH>Use</TH>
                <TH>Orientation</TH>
                <TH>Status</TH>
                <TH>Tags</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((screen) => (
                <TR key={screen.id}>
                  <TD>
                    <Link
                      href={`/company/screens/${screen.id}`}
                      className="text-foreground hover:text-primary font-medium hover:underline"
                    >
                      {screen.name}
                    </Link>
                    {screen.code ? (
                      <span className="text-muted-foreground ml-2 text-xs">{screen.code}</span>
                    ) : null}
                  </TD>
                  <TD className="text-muted-foreground">{screen.location?.name ?? 'Unassigned'}</TD>
                  <TD className="text-muted-foreground">{screenUseLabel(screen.use)}</TD>
                  <TD className="text-muted-foreground">
                    {ORIENTATION_LABELS[screen.orientation]}
                  </TD>
                  <TD>
                    <StatusBadge status={screen.status} />
                  </TD>
                  <TD>
                    {screen.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {screen.tags.map((tag) => (
                          <Badge key={tag.id} tone="info">
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDate(screen.createdAt, locale)}
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
