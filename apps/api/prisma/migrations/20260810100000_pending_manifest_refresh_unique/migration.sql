-- Replica-safe deduplication for manifest refresh commands.
--
-- Multiple API replicas may react to the same content/playlist/schedule edit at
-- the same time. The service uses createMany(..., skipDuplicates: true), while
-- this partial unique index makes PostgreSQL the authority for the invariant:
-- at most one PENDING REFRESH_MANIFEST may exist for a company/screen.
--
-- Existing duplicate pending rows are converted to CANCELLED before the index
-- is installed. The oldest pending command is preserved; later duplicates are
-- redundant because REFRESH_MANIFEST is idempotent and contains no versioned
-- payload that would be lost by cancelling it.

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "companyId", "screenId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "device_commands"
  WHERE "commandType" = 'REFRESH_MANIFEST'
    AND "status" = 'PENDING'
)
UPDATE "device_commands" AS dc
SET
  "status" = 'CANCELLED',
  "completedAt" = COALESCE(dc."completedAt", CURRENT_TIMESTAMP),
  "error" = COALESCE(dc."error", 'Superseded by pending manifest refresh dedup migration.'),
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE dc."id" = ranked."id"
  AND ranked.rn > 1;

CREATE UNIQUE INDEX "device_commands_one_pending_refresh_per_screen_key"
  ON "device_commands" ("companyId", "screenId")
  WHERE "commandType" = 'REFRESH_MANIFEST'
    AND "status" = 'PENDING';
