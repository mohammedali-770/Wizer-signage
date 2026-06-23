'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Search } from 'lucide-react';

import { useApiResource } from '@/lib/use-api';
import { formatDate, formatNumber } from '@/lib/format';
import type { CompanyListItem, CompanyStatus, Paginated } from '@/lib/types';
import { Link } from '@/i18n/navigation';
import {
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

const STATUS_OPTIONS: CompanyStatus[] = ['ACTIVE', 'SUSPENDED', 'PENDING', 'CANCELLED'];

export default function CompaniesPage() {
  const locale = useLocale();

  // Applied (committed) query state that drives the request.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | CompanyStatus>('');

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
    return `/companies?${params.toString()}`;
  }, [page, search, status]);

  const { data, loading, error } = useApiResource<Paginated<CompanyListItem>>(path);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const onStatusChange = (value: string) => {
    setStatus(value as '' | CompanyStatus);
    setPage(1);
  };

  const items = data?.items ?? [];
  const meta = data?.meta;

  return (
    <div>
      <PageHeader
        title="Companies"
        description="Tenant accounts across the platform."
        actions={
          <Link
            href="/admin/companies/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" />
            New Company
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
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or slug…"
              className="ps-9"
              aria-label="Search companies"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
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

      {!loading && error && <EmptyState title="Could not load companies" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No companies found"
          description={
            search || status
              ? 'Try adjusting your search or status filter.'
              : 'Create your first company to get started.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Slug</TH>
                <TH>Status</TH>
                <TH>Plan</TH>
                <TH className="text-end">Users</TH>
                <TH className="text-end">Locations</TH>
                <TH className="text-end">Screens</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((company) => (
                <TR key={company.id}>
                  <TD>
                    <Link
                      href={`/admin/companies/${company.id}`}
                      className="text-foreground hover:text-primary font-medium hover:underline"
                    >
                      {company.name}
                    </Link>
                  </TD>
                  <TD className="text-muted-foreground">{company.slug}</TD>
                  <TD>
                    <StatusBadge status={company.status} />
                  </TD>
                  <TD>
                    {company.subscription?.plan?.name ? (
                      <div className="flex flex-col gap-1">
                        <span>{company.subscription.plan.name}</span>
                        <StatusBadge status={company.subscription.status} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="text-end tabular-nums">
                    {formatNumber(company.metrics.users, locale)}
                  </TD>
                  <TD className="text-end tabular-nums">
                    {formatNumber(company.metrics.locations, locale)}
                  </TD>
                  <TD className="text-end tabular-nums">
                    {formatNumber(company.metrics.screens, locale)}
                  </TD>
                  <TD className="text-muted-foreground whitespace-nowrap">
                    {formatDate(company.createdAt, locale)}
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
