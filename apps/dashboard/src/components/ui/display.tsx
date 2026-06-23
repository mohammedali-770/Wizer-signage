import { useTranslations } from 'next-intl';

import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'border-border bg-card text-card-foreground rounded-2xl border shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-border border-b px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  danger: 'bg-red-500/15 text-red-600 dark:text-red-400',
  info: 'bg-blue-600/15 text-blue-600 dark:text-blue-400',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

// Tone for every backend status/severity code shown in a badge (company + admin).
// Keys here are also the set of codes StatusBadge localizes via `enums.status` —
// every key must have a matching label in messages; codes absent here render raw.
const STATUS_TONES: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  PAID: 'success',
  TRIALING: 'info',
  DRAFT: 'neutral',
  PENDING: 'neutral',
  UNPAID: 'warning',
  OVERDUE: 'danger',
  SUSPENDED: 'danger',
  EXPIRED: 'danger',
  CANCELLED: 'neutral',
  DISABLED: 'danger',
  LOCKED: 'danger',
  INVITED: 'info',
  // Screen / device statuses — make fleet health scannable at a glance.
  ONLINE: 'success',
  OFFLINE: 'danger',
  WARNING: 'warning',
  PAIRING: 'info',
  UNPAIRED: 'warning',
  SYNCING: 'info',
  ARCHIVED: 'neutral',
  // Lifecycle / job / alert / delivery statuses + severities.
  ACCEPTED: 'success',
  ACKNOWLEDGED: 'info',
  CLAIMED: 'info',
  COMMITTED: 'success',
  COMPLETED: 'success',
  CRITICAL: 'danger',
  DELETED: 'danger',
  DELIVERED: 'success',
  DISMISSED: 'neutral',
  ENDED: 'neutral',
  FAILED: 'danger',
  IDLE: 'neutral',
  INACTIVE: 'neutral',
  INFO: 'info',
  INTERRUPTED: 'danger',
  OFFLINE_PLAYBACK: 'info',
  OPEN: 'warning',
  PARTIAL: 'warning',
  PAUSED: 'warning',
  READY: 'success',
  RESOLVED: 'success',
  REVOKED: 'danger',
  RUNNING: 'info',
  SCHEDULED: 'info',
  SENT: 'success',
  SKIPPED: 'neutral',
  STARTED: 'info',
  SUCCEEDED: 'success',
  SUCCESS: 'success',
  TRASH: 'neutral',
  UPLOADED: 'success',
  VALIDATED: 'success',
};

/** Map a domain status string to a coloured, localized Badge. */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('enums.status');
  // Only translate codes we have labels for; unknown codes render raw (no missing-key throw).
  const label = status in STATUS_TONES ? t(status) : status;
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{label}</Badge>;
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  /** Optional illustrative icon shown above the title (e.g. a lucide <Icon />). */
  icon?: React.ReactNode;
  /** Optional primary call-to-action shown below the description (e.g. a create button). */
  action?: React.ReactNode;
}) {
  return (
    <div className="border-border rounded-2xl border border-dashed px-6 py-12 text-center">
      {icon ? (
        <div className="text-muted-foreground/50 mb-3 flex justify-center [&>svg]:size-10">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** A single animated placeholder block. Use to outline content while it loads. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-muted/60 animate-pulse rounded-md', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Placeholder rows for a table/list while the first page of data loads. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-border flex items-center gap-4 border-b px-1 py-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4', c === 0 ? 'w-1/4' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a metric/usage card. */
export function StatCardSkeleton() {
  return (
    <Card className="p-5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-3 h-4 w-16" />
    </Card>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
    </Card>
  );
}
