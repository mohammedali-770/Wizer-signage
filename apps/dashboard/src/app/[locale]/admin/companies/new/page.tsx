'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { Company, Paginated, Plan } from '@/lib/types';
import { Link, useRouter } from '@/i18n/navigation';
import {
  Button,
  Card,
  CardContent,
  Field,
  Input,
  PageHeader,
  Select,
  useToast,
} from '@/components/ui';

interface CreateCompanyBody {
  name: string;
  slug?: string;
  defaultLocale?: string;
  timezone?: string;
  planId?: string;
}

export default function NewCompanyPage() {
  const router = useRouter();
  const { toast } = useToast();

  const { data: plansData } = useApiResource<Paginated<Plan>>('/plans?pageSize=100&isActive=true');
  const plans = plansData?.items ?? [];

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [defaultLocale, setDefaultLocale] = useState('en');
  const [timezone, setTimezone] = useState('UTC');
  const [planId, setPlanId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    const body: CreateCompanyBody = { name: name.trim() };
    if (slug.trim()) body.slug = slug.trim();
    if (defaultLocale) body.defaultLocale = defaultLocale;
    if (timezone.trim()) body.timezone = timezone.trim();
    if (planId) body.planId = planId;

    setSubmitting(true);
    try {
      const created = await api.post<Company>('/companies', body);
      toast('Company created.', 'success');
      router.push(`/admin/companies/${created.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong.', 'error');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="New company"
        description="Provision a new tenant on the platform."
        actions={
          <Link href="/admin/companies">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              Back to companies
            </Button>
          </Link>
        }
      />

      <Card className="max-w-2xl">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                required
                autoFocus
              />
            </Field>

            <Field label="Slug" hint="Auto-generated from the name if left blank.">
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-inc"
              />
            </Field>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Default locale">
                <Select value={defaultLocale} onChange={(e) => setDefaultLocale(e.target.value)}>
                  <option value="en">English (en)</option>
                  <option value="ar">Arabic (ar)</option>
                </Select>
              </Field>

              <Field label="Timezone">
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </Field>
            </div>

            <Field label="Plan" hint="Optional. Creates a subscription for the company.">
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">No subscription</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} ({plan.code})
                  </option>
                ))}
              </Select>
            </Field>

            <div className="border-border flex items-center justify-end gap-2 border-t pt-5">
              <Link href="/admin/companies">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? 'Creating…' : 'Create company'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
