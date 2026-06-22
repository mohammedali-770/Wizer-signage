'use client';

import { useState } from 'react';

import { api, ApiError } from '@/lib/api';
import { useApiResource } from '@/lib/use-api';
import type {
  LocationListItem,
  Orientation,
  Paginated,
  Screen,
  ScreenUse,
  WorkingHours,
} from '@/lib/types';
import { useRouter, Link } from '@/i18n/navigation';
import { WorkingHoursEditor } from '@/components/working-hours-editor';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Label,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';

const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: 'LANDSCAPE', label: 'Landscape' },
  { value: 'PORTRAIT', label: 'Portrait' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

const USE_OPTIONS: { value: ScreenUse; label: string }[] = [
  { value: 'MENU_LANDSCAPE', label: 'Menu (Landscape)' },
  { value: 'OFFERS_PORTRAIT', label: 'Offers (Portrait)' },
  { value: 'WAITING_AREA', label: 'Waiting Area' },
  { value: 'CASHIER_DISPLAY', label: 'Cashier Display' },
  { value: 'ENTRANCE', label: 'Entrance' },
  { value: 'INDOOR', label: 'Indoor' },
  { value: 'OUTDOOR', label: 'Outdoor' },
  { value: 'GENERIC', label: 'Generic/Custom' },
];

const PIN_RE = /^\d{4,8}$/;

export default function NewScreenPage() {
  const router = useRouter();
  const { toast } = useToast();

  const locations = useApiResource<Paginated<LocationListItem>>('/locations?pageSize=100');

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [locationId, setLocationId] = useState('');
  const [use, setUse] = useState<'' | ScreenUse>('');
  const [orientation, setOrientation] = useState<Orientation>('LANDSCAPE');

  const [audioEnabled, setAudioEnabled] = useState(false);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);

  const [kioskEnabled, setKioskEnabled] = useState(false);
  const [kioskPin, setKioskPin] = useState('');
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  const [workingHours, setWorkingHours] = useState<WorkingHours | null>(null);

  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('Name is required.', 'error');
      return;
    }
    const pin = kioskPin.trim();
    if (pin && !PIN_RE.test(pin)) {
      toast('Kiosk PIN must be 4-8 digits.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        orientation,
        audioEnabled,
        volume,
        muted,
        kioskEnabled,
        autoStartEnabled,
      };
      if (code.trim()) payload.code = code.trim();
      if (description.trim()) payload.description = description.trim();
      if (locationId) payload.locationId = locationId;
      if (use) payload.use = use;
      if (pin) payload.kioskPin = pin;
      if (workingHours) payload.workingHours = workingHours;

      const created = await api.post<Screen>('/screens', payload);
      toast('Screen created.', 'success');
      router.push(`/company/screens/${created.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong.', 'error');
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="New Screen" description="Register a display to manage and pair later." />

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Lobby display"
                  required
                />
              </Field>
              <Field label="Code" hint="Optional internal identifier.">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="SCR-001"
                />
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Where this screen is and what it shows."
                rows={2}
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Location">
                <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {(locations.data?.items ?? []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Use">
                <Select value={use} onChange={(e) => setUse(e.target.value as '' | ScreenUse)}>
                  <option value="">Not set</option>
                  {USE_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Orientation">
                <Select
                  value={orientation}
                  onChange={(e) => setOrientation(e.target.value as Orientation)}
                >
                  {ORIENTATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="audio-enabled"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={audioEnabled}
                onChange={(e) => setAudioEnabled(e.target.checked)}
              />
              <Label htmlFor="audio-enabled" className="mb-0">
                Audio enabled
              </Label>
            </div>

            <div>
              <Label htmlFor="volume">Volume ({volume})</Label>
              <input
                id="volume"
                type="range"
                min={0}
                max={100}
                step={1}
                value={volume}
                disabled={!audioEnabled}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="accent-primary w-full disabled:opacity-50"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="muted"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={muted}
                onChange={(e) => setMuted(e.target.checked)}
              />
              <Label htmlFor="muted" className="mb-0">
                Muted
              </Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kiosk &amp; startup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <input
                id="kiosk-enabled"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={kioskEnabled}
                onChange={(e) => setKioskEnabled(e.target.checked)}
              />
              <Label htmlFor="kiosk-enabled" className="mb-0">
                Kiosk mode enabled
              </Label>
            </div>

            <Field label="Kiosk PIN" hint="Optional. 4-8 digits, used to exit kiosk mode.">
              <Input
                type="password"
                autoComplete="off"
                value={kioskPin}
                onChange={(e) => setKioskPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="e.g. 1234"
                inputMode="numeric"
                disabled={!kioskEnabled}
              />
            </Field>

            <div className="flex items-center gap-2">
              <input
                id="auto-start"
                type="checkbox"
                className="border-border accent-primary size-4 rounded"
                checked={autoStartEnabled}
                onChange={(e) => setAutoStartEnabled(e.target.checked)}
              />
              <Label htmlFor="auto-start" className="mb-0">
                Auto-start on device boot
              </Label>
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
            href="/company/screens"
            className="border-border hover:bg-muted inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={saving}>
            {saving && <Spinner className="size-4" />}
            Create screen
          </Button>
        </div>
      </form>
    </div>
  );
}
