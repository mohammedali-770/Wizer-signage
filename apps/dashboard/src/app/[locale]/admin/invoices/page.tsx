'use client';

import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Company, Invoice, InvoiceStatus, Paginated } from '@/lib/types';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Label,
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
  useToast,
} from '@/components/ui';

const PAGE_SIZE = 20;

const INVOICE_STATUSES: InvoiceStatus[] = ['DRAFT', 'UNPAID', 'PAID', 'OVERDUE', 'CANCELLED'];

interface LineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyLineItem(): LineItemDraft {
  return { description: '', quantity: '1', unitPrice: '0' };
}

export default function InvoicesPage() {
  const locale = useLocale();
  const { toast } = useToast();

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const listPath = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (statusFilter) params.set('status', statusFilter);
    return `/invoices?${params.toString()}`;
  }, [page, statusFilter]);

  const { data, loading, error, reload } = useApiResource<Paginated<Invoice>>(listPath);

  const items = data?.items ?? [];
  const meta = data?.meta;

  async function changeStatus(invoice: Invoice, status: InvoiceStatus) {
    if (status === invoice.status) return;
    setUpdatingId(invoice.id);
    try {
      await api.patch(`/invoices/${invoice.id}/status`, { status });
      toast(`Invoice ${invoice.number} marked ${status}.`, 'success');
      reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Invoices"
        description="Billing documents across all tenants."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Invoice
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Label>Status</Label>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as InvoiceStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}

      {error && !loading && <EmptyState title="Could not load invoices" description={error} />}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          title="No invoices found"
          description={
            statusFilter
              ? 'No invoices match the selected status.'
              : 'Create your first invoice to get started.'
          }
        />
      )}

      {!loading && !error && items.length > 0 && (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Company</TH>
                <TH>Status</TH>
                <TH className="text-right">Total</TH>
                <TH>Issued</TH>
                <TH>Due</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((invoice) => (
                <TR key={invoice.id}>
                  <TD className="font-medium">{invoice.number}</TD>
                  <TD>{invoice.company?.name ?? '—'}</TD>
                  <TD>
                    <StatusBadge status={invoice.status} />
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatCurrency(invoice.total, invoice.currency, locale)}
                  </TD>
                  <TD>{invoice.issuedAt ? formatDate(invoice.issuedAt, locale) : '—'}</TD>
                  <TD>{invoice.dueAt ? formatDate(invoice.dueAt, locale) : '—'}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      {updatingId === invoice.id && (
                        <Spinner className="text-muted-foreground size-4" />
                      )}
                      <Select
                        className="h-8 w-32 text-xs"
                        value={invoice.status}
                        disabled={updatingId === invoice.id}
                        onChange={(e) => changeStatus(invoice, e.target.value as InvoiceStatus)}
                      >
                        {INVOICE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {meta && <Pagination page={meta.page} totalPages={meta.totalPages} onPage={setPage} />}
        </>
      )}

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          setPage(1);
          reload();
        }}
      />
    </div>
  );
}

function CreateInvoiceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const locale = useLocale();
  const { toast } = useToast();

  // Only fetch companies when the dialog is open.
  const { data: companiesData, loading: companiesLoading } = useApiResource<Paginated<Company>>(
    open ? '/companies?pageSize=100' : null,
  );
  const companies = companiesData?.items ?? [];

  const [companyId, setCompanyId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [status, setStatus] = useState<InvoiceStatus>('DRAFT');
  const [dueAt, setDueAt] = useState('');
  const [tax, setTax] = useState('');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCompanyId('');
    setCurrency('USD');
    setStatus('DRAFT');
    setDueAt('');
    setTax('');
    setLineItems([emptyLineItem()]);
  }

  function updateLine(index: number, patch: Partial<LineItemDraft>) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addLine() {
    setLineItems((prev) => [...prev, emptyLineItem()]);
  }

  function removeLine(index: number) {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  const subtotal = useMemo(
    () =>
      lineItems.reduce((sum, item) => {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.unitPrice) || 0;
        return sum + qty * price;
      }, 0),
    [lineItems],
  );
  const taxValue = Number(tax) || 0;
  const total = subtotal + taxValue;

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyId) {
      toast('Please select a company.', 'error');
      return;
    }
    const cleanedLineItems = lineItems
      .map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      }))
      .filter((item) => item.description.length > 0);

    if (cleanedLineItems.length === 0) {
      toast('Add at least one line item with a description.', 'error');
      return;
    }
    if (
      cleanedLineItems.some(
        (item) =>
          !Number.isFinite(item.quantity) || !Number.isFinite(item.unitPrice) || item.quantity <= 0,
      )
    ) {
      toast('Line items need a positive quantity and a valid price.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      await api.post<Invoice>('/invoices', {
        companyId,
        currency,
        status,
        lineItems: cleanedLineItems,
        ...(taxValue > 0 ? { tax: taxValue } : {}),
        ...(dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
      });
      toast('Invoice created.', 'success');
      reset();
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="New Invoice"
      description="Create a billing document for a tenant company."
      className="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Company">
            <Select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={companiesLoading}
              required
            >
              <option value="">
                {companiesLoading ? 'Loading companies…' : 'Select a company'}
              </option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Currency">
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="USD"
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Line items</Label>
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              <Plus className="size-3.5" />
              Add line
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-muted-foreground hidden grid-cols-[1fr_5rem_7rem_auto] gap-2 px-1 text-xs font-medium uppercase sm:grid">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span className="sr-only">Remove</span>
            </div>
            {lineItems.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_5rem_7rem_auto] gap-2">
                <Input
                  value={item.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                  placeholder="Description"
                />
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={item.quantity}
                  onChange={(e) => updateLine(index, { quantity: e.target.value })}
                  className="text-right"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                  className="text-right"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground px-2"
                  onClick={() => removeLine(index)}
                  disabled={lineItems.length === 1}
                  aria-label="Remove line item"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Tax" hint="Optional">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
              placeholder="0.00"
              className="text-right"
            />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date" hint="Optional">
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </Field>
        </div>

        <div className="border-border bg-muted/30 rounded-lg border px-4 py-3 text-sm">
          <div className="text-muted-foreground flex items-center justify-between">
            <span>Subtotal</span>
            <span className="text-foreground tabular-nums">
              {formatCurrency(subtotal, currency || 'USD', locale)}
            </span>
          </div>
          <div className="text-muted-foreground mt-1 flex items-center justify-between">
            <span>Tax</span>
            <span className="text-foreground tabular-nums">
              {formatCurrency(taxValue, currency || 'USD', locale)}
            </span>
          </div>
          <div className="border-border mt-2 flex items-center justify-between border-t pt-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatCurrency(total, currency || 'USD', locale)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Spinner className="size-4" />}
            Create Invoice
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
