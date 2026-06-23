'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
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
  const t = useTranslations('pages.adminCompanies');
  const tc = useTranslations('common');
  const te = useTranslations('enums');

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
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href="/admin/companies/new"
            className="bg-primary text-primary-foreground focus-visible:ring-primary/40 inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
          >
            <Plus className="size-4" />
            {t('newCompany')}
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
              placeholder={t('searchPlaceholder')}
              className="ps-9"
              aria-label={t('searchCompanies')}
            />
          </div>
          <Button type="submit" variant="outline">
            {tc('search')}
          </Button>
        </form>

        <Select
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-44"
          aria-label={t('filterByStatus')}
        >
          <option value="">{t('allStatuses')}</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {te(`status.${s}`)}
            </option>
          ))}
        </Select>
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
          description={search || status ? t('emptyFiltered') : t('emptyCreateFirst')}
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{tc('name')}</TH>
                <TH>{t('slug')}</TH>
                <TH>{tc('status')}</TH>
                <TH>{t('plan')}</TH>
                <TH className="text-end">{t('users')}</TH>
                <TH className="text-end">{t('locations')}</TH>
                <TH className="text-end">{t('screens')}</TH>
                <TH>{tc('created')}</TH>
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
