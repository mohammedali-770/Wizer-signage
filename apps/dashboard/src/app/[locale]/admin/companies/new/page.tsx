'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { useAllPages } from '@/lib/use-api';
import type { Company, Plan } from '@/lib/types';
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
  const t = useTranslations('pages.adminCompanyNew');
  const tc = useTranslations('common');

  const { data: plansData } = useAllPages<Plan>('/plans?isActive=true');
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
      toast(t('toastCreated'), 'success');
      router.push(`/admin/companies/${created.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('toastError'), 'error');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/admin/companies">
            <Button variant="outline">
              <ArrowLeft className="size-4" />
              {t('backToCompanies')}
            </Button>
          </Link>
        }
      />

      <Card className="max-w-2xl">
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <Field label={tc('name')}>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Inc."
                required
                autoFocus
              />
            </Field>

            <Field label={t('slug')} hint={t('slugHint')}>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-inc"
              />
            </Field>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={t('defaultLocale')}>
                <Select value={defaultLocale} onChange={(e) => setDefaultLocale(e.target.value)}>
                  <option value="en">{t('localeEnglish')}</option>
                  <option value="ar">{t('localeArabic')}</option>
                </Select>
              </Field>

              <Field label={t('timezone')}>
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </Field>
            </div>

            <Field label={t('plan')} hint={t('planHint')}>
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">{t('noSubscription')}</option>
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
                  {tc('cancel')}
                </Button>
              </Link>
              <Button type="submit" disabled={!canSubmit}>
                {submitting ? t('creating') : t('createCompany')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
