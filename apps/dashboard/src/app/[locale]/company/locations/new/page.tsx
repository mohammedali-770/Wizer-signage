'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import type { Location, WorkingHours } from '@/lib/types';
import { Link, useRouter } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

interface FormState {
  name: string;
  code: string;
  description: string;
  address: string;
  city: string;
  region: string;
  country: string;
  timezone: string;
  latitude: string;
  longitude: string;
}

function blankForm(): FormState {
  return {
    name: '',
    code: '',
    description: '',
    address: '',
    city: '',
    region: '',
    country: '',
    timezone: '',
    latitude: '',
    longitude: '',
  };
}

/** Parse a number string into a finite number or null (blank/invalid -> null). */
function numberOrNull(value: string): number | null {
  const raw = value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function NewLocationPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(blankForm);
  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (key: keyof FormState, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast('Name is required.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        description: form.description.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        region: form.region.trim() || undefined,
        country: form.country.trim() || undefined,
        timezone: form.timezone.trim() || undefined,
        latitude: numberOrNull(form.latitude) ?? undefined,
        longitude: numberOrNull(form.longitude) ?? undefined,
        workingHours: workingHours ?? undefined,
      };

      const created = await api.post<Location>('/locations', payload);
      toast('Location created.', 'success');
      router.push(`/company/locations/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <Link
        href="/company/locations"
        className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-4" />
        Back to locations
      </Link>

      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New Location</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Main Branch"
                  required
                />
              </Field>
              <Field label="Code" hint="Optional short identifier.">
                <Input
                  value={form.code}
                  onChange={(e) => update('code', e.target.value)}
                  placeholder="MB-01"
                />
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder="Notes about this location."
                rows={2}
              />
            </Field>

            <Field label="Address">
              <Input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder="123 King Fahd Road"
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="City">
                <Input
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder="Riyadh"
                />
              </Field>
              <Field label="Region">
                <Input
                  value={form.region}
                  onChange={(e) => update('region', e.target.value)}
                  placeholder="Riyadh Province"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                  placeholder="Saudi Arabia"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Timezone">
                <Input
                  value={form.timezone}
                  onChange={(e) => update('timezone', e.target.value)}
                  placeholder="Asia/Riyadh"
                />
              </Field>
              <Field label="Latitude">
                <Input
                  type="number"
                  step="any"
                  value={form.latitude}
                  onChange={(e) => update('latitude', e.target.value)}
                  placeholder="24.7136"
                />
              </Field>
              <Field label="Longitude">
                <Input
                  type="number"
                  step="any"
                  value={form.longitude}
                  onChange={(e) => update('longitude', e.target.value)}
                  placeholder="46.6753"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Working hours</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkingHoursEditor value={workingHours} onChange={setWorkingHours} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link
            href="/company/locations"
            className="border-border hover:bg-muted inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner className="size-4" />}
            Create location
          </Button>
        </div>
      </form>
    </div>
  );
}
