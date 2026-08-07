'use client';

import { useTranslations } from 'next-intl';

import type { DayHours, OutsideHoursBehavior, WorkingHours } from '@/lib/types';
import { Input, Label, Select } from '@/components/ui';

// Selectable options. 'SLEEP' is deliberately absent: it is the legacy name for
// 'BLANK_SCREEN' and is accepted on read only, so it is never offered anew.
const BEHAVIOR_VALUES: OutsideHoursBehavior[] = [
  'FALLBACK',
  'BLACK_SCREEN',
  'CUSTOM_MESSAGE',
  'BLANK_SCREEN',
];

function defaultDays(): DayHours[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    closed: false,
    open: '09:00',
    close: '21:00',
  }));
}

/**
 * Controlled weekly working-hours editor. What is set here is enforced end to
 * end: the schedule resolver evaluates it and the Android player acts on the
 * resulting manifest. Overnight ranges (close < open) are allowed.
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
  const t = useTranslations('pages.workingHours');
  const te = useTranslations('enums');
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
          <Label>{t('timezone')}</Label>
          <Input
            value={wh.timezone ?? ''}
            placeholder={timezonePlaceholder ?? t('timezonePlaceholder')}
            onChange={(e) => patch({ timezone: e.target.value || undefined })}
          />
        </div>
      </div>

      <div className="space-y-2">
        {days.map((d, i) => (
          <div key={d.day} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-10 font-medium">{te(`day.${d.day}`)}</span>
            <label className="text-muted-foreground flex items-center gap-1">
              <input
                type="checkbox"
                checked={d.closed}
                onChange={(e) => patchDay(i, { closed: e.target.checked })}
              />
              {t('closed')}
            </label>
            {!d.closed && (
              <>
                <Input
                  type="time"
                  className="h-8 w-28"
                  value={d.open ?? ''}
                  onChange={(e) => patchDay(i, { open: e.target.value })}
                />
                <span className="text-muted-foreground">{t('to')}</span>
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
          <Label>{t('outsideActiveHours')}</Label>
          <Select
            value={wh.outsideHoursBehavior ?? 'FALLBACK'}
            onChange={(e) =>
              patch({ outsideHoursBehavior: e.target.value as OutsideHoursBehavior })
            }
          >
            {BEHAVIOR_VALUES.map((b) => (
              <option key={b} value={b}>
                {te(`outsideHours.${b}`)}
              </option>
            ))}
          </Select>
        </div>
        {wh.outsideHoursBehavior === 'CUSTOM_MESSAGE' && (
          <div>
            <Label>{t('customMessage')}</Label>
            <Input
              value={wh.outsideHoursMessage ?? ''}
              onChange={(e) => patch({ outsideHoursMessage: e.target.value })}
            />
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('phaseHelp')}</p>
    </div>
  );
}
