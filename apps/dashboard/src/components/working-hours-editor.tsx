'use client';

import type { DayHours, OutsideHoursBehavior, WorkingHours } from '@/lib/types';
import { Input, Label, Select } from '@/components/ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const BEHAVIORS: { value: OutsideHoursBehavior; label: string }[] = [
  { value: 'FALLBACK', label: 'Show fallback content' },
  { value: 'BLACK_SCREEN', label: 'Black screen' },
  { value: 'CUSTOM_MESSAGE', label: 'Custom message' },
  { value: 'SLEEP', label: 'Attempt sleep / power saving' },
];

function defaultDays(): DayHours[] {
  return DAY_LABELS.map((_, day) => ({ day, closed: false, open: '09:00', close: '21:00' }));
}

/**
 * Controlled weekly working-hours editor (configuration only — Android playback
 * execution comes in a later phase). Overnight ranges (close < open) are allowed.
 */
export function WorkingHoursEditor({
  value,
  onChange,
  timezonePlaceholder,
}: {
  value: WorkingHours | null;
  onChange: (next: WorkingHours) => void;
  timezonePlaceholder?: string;
}) {
  const wh: WorkingHours = value ?? {};
  const days = wh.days && wh.days.length ? wh.days : defaultDays();

  const patch = (next: Partial<WorkingHours>) => onChange({ ...wh, days, ...next });
  const patchDay = (index: number, next: Partial<DayHours>) => {
    const updated = days.map((d, i) => (i === index ? { ...d, ...next } : d));
    onChange({ ...wh, days: updated });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Timezone (optional)</Label>
          <Input
            value={wh.timezone ?? ''}
            placeholder={timezonePlaceholder ?? 'e.g. Asia/Riyadh'}
            onChange={(e) => patch({ timezone: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="space-y-2">
        {days.map((d, i) => (
          <div key={d.day} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-10 font-medium">{DAY_LABELS[d.day]}</span>
            <label className="text-muted-foreground flex items-center gap-1">
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => patchDay(i, { closed: e.target.checked })}
              />
              Closed
            </label>
            {!d.closed && (
              <>
                <Input
                  type="time"
                  className="h-8 w-28"
                  value={d.open ?? ''}
                  onChange={(e) => patchDay(i, { open: e.target.value })}
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="time"
                  className="h-8 w-28"
                  value={d.close ?? ''}
                  onChange={(e) => patchDay(i, { close: e.target.value })}
                />
              </>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Outside active hours</Label>
          <Select
            value={wh.outsideHoursBehavior ?? 'FALLBACK'}
            onChange={(e) =>
              patch({ outsideHoursBehavior: e.target.value as OutsideHoursBehavior })
            }
          >
            {BEHAVIORS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>
        {wh.outsideHoursBehavior === 'CUSTOM_MESSAGE' && (
          <div>
            <Label>Custom message</Label>
            <Input
              value={wh.outsideHoursMessage ?? ''}
              onChange={(e) => patch({ outsideHoursMessage: e.target.value })}
            />
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Configuration only in this phase — devices apply working hours in a later phase.
      </p>
    </div>
  );
}
