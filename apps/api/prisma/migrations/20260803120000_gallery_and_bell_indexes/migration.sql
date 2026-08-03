-- Read-path indexes for the screenshot gallery and the notification bell.
--
-- Both queries filter on one column and sort on another, so a single-column
-- index on the filter forced a sort of every matching row. The bell in
-- particular is polled by every dashboard page load, and its unread count has
-- no covering index at all today.
--
-- NOTE for a LARGE, live database: a plain CREATE INDEX briefly locks the table
-- against writes. On a fresh/small deployment this is instant. If these tables
-- are already very large, create them manually with CREATE INDEX CONCURRENTLY
-- during low traffic INSTEAD of running this migration (CONCURRENTLY cannot run
-- inside Prisma's migration transaction), then:
--   prisma migrate resolve --applied 20260803120000_gallery_and_bell_indexes

-- screenshot.service.ts list(): WHERE companyId = $1 AND screenId = $2
-- ORDER BY "takenAt" DESC. The composite serves filter + sort together and
-- fully subsumes the screenId-only and companyId-only indexes it replaces.
CREATE INDEX "screenshots_screenId_takenAt_idx" ON "screenshots"("screenId", "takenAt" DESC);
CREATE INDEX "screenshots_companyId_takenAt_idx" ON "screenshots"("companyId", "takenAt" DESC);
DROP INDEX IF EXISTS "screenshots_screenId_idx";
DROP INDEX IF EXISTS "screenshots_companyId_idx";

-- notification.service.ts list(): WHERE "userId" = $1 ORDER BY "createdAt" DESC.
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);
DROP INDEX IF EXISTS "notifications_userId_idx";

-- unreadCount(): SELECT count(*) WHERE "userId" = $1 AND "readAt" IS NULL,
-- run on every dashboard page load. A PARTIAL index indexes only unread rows,
-- so it stays small permanently even as the read history grows without bound —
-- Prisma's schema language cannot express this, so it lives only here. Prisma
-- ignores indexes it does not know about, so it does not register as drift.
CREATE INDEX "notifications_unread_idx" ON "notifications"("userId") WHERE "readAt" IS NULL;
