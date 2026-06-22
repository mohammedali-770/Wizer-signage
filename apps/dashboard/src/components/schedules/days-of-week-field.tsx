'use client';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Toggles the active days of week (0=Sun … 6=Sat). An empty selection means
 * "every day" (matches the resolver's semantics).
 */
export function DaysOfWeekField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) =>
    onChange(
      value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b),
    );

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {DAYS.map((label, day) => {
          const active = value.includes(day);
          return (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              className={`h-9 w-12 rounded-md border text-sm transition ${
                active
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">Leave all unselected to run every day.</p>
    </div>
  );
}
