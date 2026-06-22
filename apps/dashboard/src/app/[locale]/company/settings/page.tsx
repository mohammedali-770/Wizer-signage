'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Save, ShieldCheck } from 'lucide-react';

import { api, apiFetch, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type { CompanySettings, WorkingHours } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  StatusBadge,
  useToast,
} from '@/components/ui';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import { FallbackContentPicker } from '@/components/content/fallback-content-picker';

interface FormState {
  name: string;
  defaultLocale: string;
  timezone: string;
  heartbeat: string;
  notificationEmails: string;
  defaultWorkingHours: WorkingHours | null;
}

function formFromSettings(s: CompanySettings): FormState {
  return {
    name: s.name ?? '',
    defaultLocale: s.defaultLocale ?? 'en',
    timezone: s.timezone ?? '',
    heartbeat: String(s.defaultHeartbeatIntervalSeconds ?? ''),
    notificationEmails: (s.notificationEmails ?? []).join(', '),
    defaultWorkingHours: s.defaultWorkingHours ?? null,
  };
}

/** Split a comma/whitespace-separated string into a de-duplicated email list. */
function parseEmails(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const email = part.trim();
    if (email && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      out.push(email);
    }
  }
  return out;
}

const PIN_PATTERN = /^\d{4,8}$/;

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const { data, loading, error, reload } = useApiResource<CompanySettings>('/company-settings');

  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  // PIN card state
  const [pin, setPin] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinClearing, setPinClearing] = useState(false);

  // Fallback content card state
  const [fallbackSaving, setFallbackSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(formFromSettings(data));
  }, [data]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.name.trim()) {
      toast('Company name is required.', 'error');
      return;
    }
    const heartbeatNum = form.heartbeat.trim() === '' ? null : Number(form.heartbeat);
    if (heartbeatNum !== null && (!Number.isFinite(heartbeatNum) || heartbeatNum <= 0)) {
      toast('Heartbeat interval must be a positive number.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        defaultLocale: form.defaultLocale,
        timezone: form.timezone.trim(),
        notificationEmails: parseEmails(form.notificationEmails),
        defaultWorkingHours: form.defaultWorkingHours,
      };
      if (heartbeatNum !== null) payload.defaultHeartbeatIntervalSeconds = heartbeatNum;

      await api.patch<CompanySettings>('/company-settings', payload);
      toast('Settings saved.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetPin = async () => {
    if (!PIN_PATTERN.test(pin)) {
      toast('PIN must be 4 to 8 digits.', 'error');
      return;
    }
    setPinSaving(true);
    try {
      await apiFetch<unknown>('/company-settings/kiosk-pin', { method: 'PUT', body: { pin } });
      toast('Default kiosk PIN saved.', 'success');
      setPin('');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setPinSaving(false);
    }
  };

  const handleFallbackChange = async (contentId: string | null) => {
    setFallbackSaving(true);
    try {
      await api.patch<CompanySettings>('/company-settings', { fallbackContentId: contentId });
      toast(contentId ? 'Fallback content updated.' : 'Fallback content cleared.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setFallbackSaving(false);
    }
  };

  const handleClearPin = async () => {
    setPinClearing(true);
    try {
      await api.del<unknown>('/company-settings/kiosk-pin');
      toast('Default kiosk PIN cleared.', 'success');
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
    } finally {
      setPinClearing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Company Settings"
        description="Manage company defaults, kiosk security, and review your plan."
      />

      {loading && (
        <div className="flex justify-center py-16">
          <Spinner className="text-primary size-6" />
        </div>
      )}
      {error && !loading && <EmptyState title="Could not load settings" description={error} />}

      {!loading && !error && data && form && (
        <div className="space-y-6">
          {/* General settings ------------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Company name">
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
                      placeholder="Acme Inc."
                      required
                    />
                  </Field>
                  <Field label="Default language">
                    <Select
                      value={form.defaultLocale}
                      onChange={(e) => setForm((f) => f && { ...f, defaultLocale: e.target.value })}
                    >
                      <option value="en">English (en)</option>
                      <option value="ar">Arabic (ar)</option>
                    </Select>
                  </Field>
                  <Field label="Timezone" hint="IANA timezone applied as the company default.">
                    <Input
                      value={form.timezone}
                      onChange={(e) => setForm((f) => f && { ...f, timezone: e.target.value })}
                      placeholder="e.g. Asia/Riyadh"
                    />
                  </Field>
                  <Field
                    label="Default heartbeat interval (seconds)"
                    hint="How often screens report in by default."
                  >
                    <Input
                      type="number"
                      min="1"
                      value={form.heartbeat}
                      onChange={(e) => setForm((f) => f && { ...f, heartbeat: e.target.value })}
                      placeholder="60"
                    />
                  </Field>
                </div>

                <Field
                  label="Notification emails"
                  hint="Comma-separated. Alerts and reports are sent to these addresses."
                >
                  <Input
                    value={form.notificationEmails}
                    onChange={(e) =>
                      setForm((f) => f && { ...f, notificationEmails: e.target.value })
                    }
                    placeholder="ops@acme.com, alerts@acme.com"
                  />
                </Field>

                <div>
                  <Label>Default working hours</Label>
                  <p className="text-muted-foreground mb-3 text-xs">
                    Applied to new locations and screens unless overridden.
                  </p>
                  <div className="border-border rounded-lg border p-4">
                    <WorkingHoursEditor
                      value={form.defaultWorkingHours}
                      onChange={(wh) => setForm((f) => f && { ...f, defaultWorkingHours: wh })}
                      timezonePlaceholder={form.timezone || 'e.g. Asia/Riyadh'}
                    />
                  </div>
                </div>

                <div className="border-border flex justify-end border-t pt-4">
                  <Button type="submit" disabled={saving}>
                    {saving ? <Spinner className="size-4" /> : <Save className="size-4" />}
                    Save changes
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Fallback content ----------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Fallback content</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Shown on screens when no playlist or schedule is active. Only ACTIVE content can be
                chosen — this default applies to every screen that does not set its own location- or
                screen-level fallback.
              </p>
              <FallbackContentPicker
                value={data.fallbackContentId}
                onChange={handleFallbackChange}
                busy={fallbackSaving}
              />
            </CardContent>
          </Card>

          {/* Default kiosk PIN ---------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Default kiosk PIN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="text-muted-foreground size-4" aria-hidden />
                {data.hasDefaultKioskPin ? (
                  <Badge tone="success">A default PIN is set</Badge>
                ) : (
                  <Badge tone="neutral">No default PIN set</Badge>
                )}
              </div>

              <p className="text-muted-foreground text-sm">
                This PIN is the default used to exit kiosk mode on screens that do not have their
                own PIN. It is stored hashed and is never displayed — set a new value to replace it.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="w-48">
                  <Field
                    label={data.hasDefaultKioskPin ? 'Update PIN' : 'Set PIN'}
                    hint="4 to 8 digits."
                  >
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      maxLength={8}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="••••"
                    />
                  </Field>
                </div>
                <Button onClick={handleSetPin} disabled={pinSaving || !pin}>
                  {pinSaving && <Spinner className="size-4" />}
                  {data.hasDefaultKioskPin ? 'Update PIN' : 'Set PIN'}
                </Button>
                {data.hasDefaultKioskPin && (
                  <Button variant="outline" onClick={handleClearPin} disabled={pinClearing}>
                    {pinClearing && <Spinner className="size-4" />}
                    Clear PIN
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Plan (read-only) ----------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.plan ? (
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="text-muted-foreground size-5" aria-hidden />
                    <div>
                      <p className="text-base font-semibold tracking-tight">{data.plan.name}</p>
                      <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                        {data.plan.code}
                      </code>
                    </div>
                  </div>
                  <StatusBadge status={data.plan.status} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No plan is assigned.</p>
              )}
              <p className="text-muted-foreground text-sm">
                Plan selection and billing are managed by the platform administrator (Super Admin).
                Contact them to upgrade, downgrade, or change billing details.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
