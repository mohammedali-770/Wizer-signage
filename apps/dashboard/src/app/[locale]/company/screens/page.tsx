'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, Plus, Search } from 'lucide-react';

import { ServerSearchSelect } from '@/components/server-search-select';
import { useApiResource } from '@/lib/use-api';
import { formatDate } from '@/lib/format';
import type { Orientation, Paginated, Screen, ScreenStatus, ScreenUse } from '@/lib/types';
import { Link } from '@/i18n/navigation';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  TableSkeleton,
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

export default function ScreensPage() {
  const locale = useLocale();
  const t = useTranslations('pages.screens');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

  const screenUseLabel = (use: ScreenUse | null): string => (use ? te(`screenUse.${use}`) : '—');

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
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/company/screens/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" />
            {t('newScreen')}
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <form
          className="flex min-w-64 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applySearch();
          }}
        >
          <div className="relative max-w-sm flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="ps-9"
              aria-label={t('searchAriaLabel')}
            />
          </div>
          <Button type="submit" variant="outline">
            {tc('search')}
          </Button>
        </form>

        <div className="w-52">
          <ServerSearchSelect
            type="LOCATION"
            value={locationId}
            onChange={(value) => {
              setLocationId(value);
              resetPage();
            }}
            emptyLabel={t('allLocations')}
            searchPlaceholder={t('filterByLocation')}
          />
        </div>

        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | ScreenStatus);
            resetPage();
          }}
          className="w-40"
          aria-label={t('filterByStatus')}
        >
          <option value="">{t('allStatuses')}</option>
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
          aria-label={t('filterByOrientation')}
        >
          <option value="">{t('allOrientations')}</option>
          {ORIENTATION_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {te(`orientation.${o}`)}
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
          aria-label={t('filterByUse')}
        >
          <option value="">{t('allUses')}</option>
          {USE_OPTIONS.map((u) => (
            <option key={u} value={u}>
              {te(`screenUse.${u}`)}
            </option>
          ))}
        </Select>

        <div className="w-48">
          <ServerSearchSelect
            type="TAG"
            value={tagId}
            onChange={(value) => {
              setTagId(value);
              resetPage();
            }}
            emptyLabel={t('allTags')}
            searchPlaceholder={t('filterByTag')}
          />
        </div>
      </div>

      {/* First load → skeleton; on refetch the previous rows stay visible. */}
      {loading && items.length === 0 && <TableSkeleton rows={8} columns={6} />}

      {error && items.length === 0 && <EmptyState title={t('loadError')} description={error} />}

      {!loading &&
        !error &&
        items.length === 0 &&
        (hasFilters ? (
          <EmptyState title={t('emptyTitle')} description={t('emptyFiltered')} />
        ) : (
          <EmptyState
            title={t('emptyTitle')}
            description={t('emptyDefault')}
            icon={<Monitor aria-hidden />}
            action={
              <Link
                href="/company/screens/new"
                className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
              >
                <Plus className="size-4" />
                {t('newScreen')}
              </Link>
            }
          />
        ))}

      {items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{tc('location')}</TH>
                <TH>{t('use')}</TH>
                <TH>{tc('orientation')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{tc('tags')}</TH>
                <TH>{tc('created')}</TH>
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
                      <span className="text-muted-foreground ms-2 text-xs">{screen.code}</span>
                    ) : null}
                  </TD>
                  <TD className="text-muted-foreground">
                    {screen.location?.name ?? t('unassigned')}
                  </TD>
                  <TD className="text-muted-foreground">{screenUseLabel(screen.use)}</TD>
                  <TD className="text-muted-foreground">
                    {te(`orientation.${screen.orientation}`)}
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
