import { Skeleton, TableSkeleton } from '@/components/ui';

/**
 * Navigation boundary for the super-admin console. Same rationale as the
 * company one: it gives `<Link>` prefetch something to render for a route the
 * root layout has forced dynamic, so a click commits immediately instead of
 * freezing the previous page until the server responds.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
