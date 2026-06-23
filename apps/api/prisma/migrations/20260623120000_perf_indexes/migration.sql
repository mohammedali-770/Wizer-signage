-- Performance indexes for hot dashboard/telemetry query paths.
-- See docs/performance-tuning.md for the rationale behind each one.
--
-- NOTE for a LARGE, live database: a plain CREATE INDEX briefly locks the table
-- against writes. The tables below (esp. heartbeats) are small on a fresh
-- deployment, so this is instant. If heartbeats is already very large, create
-- these manually with CREATE INDEX CONCURRENTLY during low traffic INSTEAD of
-- running this migration (CONCURRENTLY cannot run inside Prisma's migration
-- transaction), then `prisma migrate resolve --applied 20260623120000_perf_indexes`.

-- "latest heartbeat per screen" seek + time-range cleanup (avoids scan+sort of
-- all of a screen's heartbeats; this runs on every monitoring/fleet read).
CREATE INDEX "heartbeats_screenId_createdAt_idx" ON "heartbeats"("screenId", "createdAt");

-- Alert dedup lookup runs on every condition event (heartbeat/sweep): resolves
-- to (dedupeKey, status) instead of scanning all rows for a dedupeKey.
CREATE INDEX "alerts_dedupeKey_status_idx" ON "alerts"("dedupeKey", "status");

-- Tenant-scoped activity-log views order by time within a company.
CREATE INDEX "activity_logs_companyId_createdAt_idx" ON "activity_logs"("companyId", "createdAt");
