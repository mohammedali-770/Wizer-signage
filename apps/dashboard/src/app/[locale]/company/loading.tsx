import { Skeleton, TableSkeleton } from '@/components/ui';

/**
 * Navigation boundary for the company console.
 *
 * Without a loading boundary the router had nothing to show between clicking a
 * link and the new segment's server render arriving, so the OLD page stayed
 * frozen on screen with no feedback — and, because the root layout calls
 * `connection()` (making every route dynamic), `<Link>` prefetch had nothing it
 * could render ahead of time either. Next prefetches a dynamic route only as far
 * as its nearest loading boundary; this file is that boundary.
 *
 * It renders inside CompanyShell, so the sidebar and header stay put and only
 * the content region is replaced — the navigation reads as instant even though
 * the data is still in flight.
 */
export default function CompanyLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
