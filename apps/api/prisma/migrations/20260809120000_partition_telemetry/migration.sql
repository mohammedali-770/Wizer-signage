-- Wizer Signage — monthly PostgreSQL partitioning for the two high-volume
-- telemetry tables. Prisma 5.x cannot represent PostgreSQL partitioning in PSL,
-- so this migration owns the physical layout explicitly while the Prisma models
-- continue to describe/query the supported logical table shape.
--
-- IMPORTANT: this is intentionally a one-time pre-production conversion. It
-- takes ACCESS EXCLUSIVE locks while copying/swapping the current tables so no
-- heartbeat/playback row can fall between the copy and rename. Wizer is still in
-- testing; applying this before production is much safer than attempting an
-- online rewrite after millions of rows exist.
--
-- After conversion, new partitions are created by
-- public.wizer_ensure_telemetry_partitions() and the maintenance container calls
-- it daily. The proof-of-play session registry preserves global tenant-scoped
-- idempotency because PostgreSQL cannot enforce a unique key that omits a RANGE
-- partition column.

BEGIN;

LOCK TABLE "heartbeats" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "proof_of_plays" IN ACCESS EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- Global tenant-scoped proof-of-play idempotency registry.
-- ---------------------------------------------------------------------------
CREATE TABLE "proof_of_play_session_keys" (
  "companyId"         TEXT         NOT NULL,
  "playbackSessionId" TEXT         NOT NULL,
  "screenId"          TEXT         NOT NULL,
  "proofOfPlayId"     TEXT         NOT NULL,
  "startedAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "proof_of_play_session_keys_pkey"
    PRIMARY KEY ("companyId", "playbackSessionId"),
  CONSTRAINT "proof_of_play_session_keys_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "proof_of_play_session_keys_screenId_fkey"
    FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "proof_of_play_session_keys_proofOfPlayId_key"
  ON "proof_of_play_session_keys"("proofOfPlayId");
CREATE INDEX "proof_of_play_session_keys_startedAt_idx"
  ON "proof_of_play_session_keys"("startedAt");

-- Existing data was protected by the tenant-scoped unique index introduced by
-- the proof-of-play tenancy fix, so this backfill has one key per session.
INSERT INTO "proof_of_play_session_keys"
  ("companyId", "playbackSessionId", "screenId", "proofOfPlayId", "startedAt", "createdAt")
SELECT
  "companyId", "playbackSessionId", "screenId", "id", "startedAt", "createdAt"
FROM "proof_of_plays";

-- ---------------------------------------------------------------------------
-- Heartbeat partitioned replacement.
-- LIKE deliberately excludes constraints/indexes: PostgreSQL requires every
-- unique/primary constraint on a partitioned table to include the partition key.
-- ---------------------------------------------------------------------------
CREATE TABLE "heartbeats_partitioned"
  (LIKE "heartbeats" INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS)
  PARTITION BY RANGE ("createdAt");

ALTER TABLE "heartbeats_partitioned"
  ADD CONSTRAINT "heartbeats_partitioned_pkey" PRIMARY KEY ("id", "createdAt"),
  ADD CONSTRAINT "heartbeats_partitioned_screenId_fkey"
    FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "heartbeats_partitioned_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "heartbeats_partitioned_screenId_idx" ON "heartbeats_partitioned"("screenId");
CREATE INDEX "heartbeats_partitioned_companyId_idx" ON "heartbeats_partitioned"("companyId");
CREATE INDEX "heartbeats_partitioned_createdAt_idx" ON "heartbeats_partitioned"("createdAt");
CREATE INDEX "heartbeats_partitioned_screenId_createdAt_idx"
  ON "heartbeats_partitioned"("screenId", "createdAt");

-- ---------------------------------------------------------------------------
-- Proof-of-play partitioned replacement.
-- The former UNIQUE(companyId, playbackSessionId) becomes a normal lookup index
-- here; uniqueness is enforced globally by proof_of_play_session_keys instead.
-- ---------------------------------------------------------------------------
CREATE TABLE "proof_of_plays_partitioned"
  (LIKE "proof_of_plays" INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS)
  PARTITION BY RANGE ("startedAt");

ALTER TABLE "proof_of_plays_partitioned"
  ADD CONSTRAINT "proof_of_plays_partitioned_pkey" PRIMARY KEY ("id", "startedAt"),
  ADD CONSTRAINT "proof_of_plays_partitioned_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "proof_of_plays_partitioned_screenId_fkey"
    FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "proof_of_plays_partitioned_companyId_playbackSessionId_idx"
  ON "proof_of_plays_partitioned"("companyId", "playbackSessionId");
CREATE INDEX "proof_of_plays_partitioned_companyId_startedAt_idx"
  ON "proof_of_plays_partitioned"("companyId", "startedAt");
CREATE INDEX "proof_of_plays_partitioned_screenId_startedAt_idx"
  ON "proof_of_plays_partitioned"("screenId", "startedAt");
CREATE INDEX "proof_of_plays_partitioned_startedAt_idx" ON "proof_of_plays_partitioned"("startedAt");
CREATE INDEX "proof_of_plays_partitioned_contentId_idx" ON "proof_of_plays_partitioned"("contentId");
CREATE INDEX "proof_of_plays_partitioned_emergencyBroadcastId_idx"
  ON "proof_of_plays_partitioned"("emergencyBroadcastId");
CREATE INDEX "proof_of_plays_partitioned_status_idx" ON "proof_of_plays_partitioned"("status");

-- Create every historic month that currently contains data plus six months
-- ahead. Server-authored heartbeat timestamps and proof-of-play skew/backfill
-- validation keep normal inserts inside this range; the daily maintenance job
-- continually extends it before the boundary is reached.
DO $$
DECLARE
  month_start DATE;
  end_month   DATE;
  hb_min      DATE;
  pop_min     DATE;
  part_name   TEXT;
BEGIN
  SELECT date_trunc('month', COALESCE(MIN("createdAt"), CURRENT_TIMESTAMP))::date
    INTO hb_min FROM "heartbeats";
  end_month := (date_trunc('month', CURRENT_TIMESTAMP) + interval '7 months')::date;
  month_start := hb_min;
  WHILE month_start < end_month LOOP
    part_name := format('heartbeats_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "heartbeats_partitioned" FOR VALUES FROM (%L) TO (%L)',
      part_name,
      month_start::timestamp,
      (month_start + interval '1 month')::timestamp
    );
    month_start := (month_start + interval '1 month')::date;
  END LOOP;

  SELECT date_trunc('month', COALESCE(MIN("startedAt"), CURRENT_TIMESTAMP))::date
    INTO pop_min FROM "proof_of_plays";
  month_start := pop_min;
  WHILE month_start < end_month LOOP
    part_name := format('proof_of_plays_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF "proof_of_plays_partitioned" FOR VALUES FROM (%L) TO (%L)',
      part_name,
      month_start::timestamp,
      (month_start + interval '1 month')::timestamp
    );
    month_start := (month_start + interval '1 month')::date;
  END LOOP;
END $$;

INSERT INTO "heartbeats_partitioned" SELECT * FROM "heartbeats";
INSERT INTO "proof_of_plays_partitioned" SELECT * FROM "proof_of_plays";

DO $$
DECLARE
  old_count BIGINT;
  new_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO old_count FROM "heartbeats";
  SELECT COUNT(*) INTO new_count FROM "heartbeats_partitioned";
  IF old_count <> new_count THEN
    RAISE EXCEPTION 'heartbeat partition copy mismatch: old=% new=%', old_count, new_count;
  END IF;

  SELECT COUNT(*) INTO old_count FROM "proof_of_plays";
  SELECT COUNT(*) INTO new_count FROM "proof_of_plays_partitioned";
  IF old_count <> new_count THEN
    RAISE EXCEPTION 'proof-of-play partition copy mismatch: old=% new=%', old_count, new_count;
  END IF;
END $$;

-- Atomic name swap while both source tables remain locked.
ALTER TABLE "heartbeats" RENAME TO "heartbeats_unpartitioned_20260809";
ALTER TABLE "heartbeats_partitioned" RENAME TO "heartbeats";
ALTER TABLE "proof_of_plays" RENAME TO "proof_of_plays_unpartitioned_20260809";
ALTER TABLE "proof_of_plays_partitioned" RENAME TO "proof_of_plays";

DROP TABLE "heartbeats_unpartitioned_20260809";
DROP TABLE "proof_of_plays_unpartitioned_20260809";

-- Table renames do NOT rename PostgreSQL constraints/indexes. Normalize every
-- Prisma-representable object only after the old tables are dropped and their
-- canonical names become free. This keeps schema drift focused on the truly
-- unsupported partition/trigger layer rather than temporary migration names.
ALTER TABLE "heartbeats"
  RENAME CONSTRAINT "heartbeats_partitioned_pkey" TO "heartbeats_pkey";
ALTER TABLE "heartbeats"
  RENAME CONSTRAINT "heartbeats_partitioned_screenId_fkey" TO "heartbeats_screenId_fkey";
ALTER TABLE "heartbeats"
  RENAME CONSTRAINT "heartbeats_partitioned_companyId_fkey" TO "heartbeats_companyId_fkey";
ALTER INDEX "heartbeats_partitioned_screenId_idx" RENAME TO "heartbeats_screenId_idx";
ALTER INDEX "heartbeats_partitioned_companyId_idx" RENAME TO "heartbeats_companyId_idx";
ALTER INDEX "heartbeats_partitioned_createdAt_idx" RENAME TO "heartbeats_createdAt_idx";
ALTER INDEX "heartbeats_partitioned_screenId_createdAt_idx"
  RENAME TO "heartbeats_screenId_createdAt_idx";

ALTER TABLE "proof_of_plays"
  RENAME CONSTRAINT "proof_of_plays_partitioned_pkey" TO "proof_of_plays_pkey";
ALTER TABLE "proof_of_plays"
  RENAME CONSTRAINT "proof_of_plays_partitioned_companyId_fkey" TO "proof_of_plays_companyId_fkey";
ALTER TABLE "proof_of_plays"
  RENAME CONSTRAINT "proof_of_plays_partitioned_screenId_fkey" TO "proof_of_plays_screenId_fkey";
ALTER INDEX "proof_of_plays_partitioned_companyId_playbackSessionId_idx"
  RENAME TO "proof_of_plays_companyId_playbackSessionId_idx";
ALTER INDEX "proof_of_plays_partitioned_companyId_startedAt_idx"
  RENAME TO "proof_of_plays_companyId_startedAt_idx";
ALTER INDEX "proof_of_plays_partitioned_screenId_startedAt_idx"
  RENAME TO "proof_of_plays_screenId_startedAt_idx";
ALTER INDEX "proof_of_plays_partitioned_startedAt_idx" RENAME TO "proof_of_plays_startedAt_idx";
ALTER INDEX "proof_of_plays_partitioned_contentId_idx" RENAME TO "proof_of_plays_contentId_idx";
ALTER INDEX "proof_of_plays_partitioned_emergencyBroadcastId_idx"
  RENAME TO "proof_of_plays_emergencyBroadcastId_idx";
ALTER INDEX "proof_of_plays_partitioned_status_idx" RENAME TO "proof_of_plays_status_idx";

-- ---------------------------------------------------------------------------
-- Cross-partition tenant idempotency.
-- BEFORE INSERT claims (companyId, playbackSessionId) first. A duplicate claim
-- raises PostgreSQL unique_violation (23505), which Prisma maps through the same
-- create-race path the service already handles. AFTER DELETE releases the exact
-- key so retention does not leave permanent ghost sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wizer_claim_proof_of_play_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public."proof_of_play_session_keys"
    ("companyId", "playbackSessionId", "screenId", "proofOfPlayId", "startedAt")
  VALUES
    (NEW."companyId", NEW."playbackSessionId", NEW."screenId", NEW."id", NEW."startedAt");
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wizer_release_proof_of_play_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public."proof_of_play_session_keys"
   WHERE "companyId" = OLD."companyId"
     AND "playbackSessionId" = OLD."playbackSessionId"
     AND "proofOfPlayId" = OLD."id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER "proof_of_plays_claim_session"
BEFORE INSERT ON "proof_of_plays"
FOR EACH ROW EXECUTE FUNCTION public.wizer_claim_proof_of_play_session();

CREATE TRIGGER "proof_of_plays_release_session"
AFTER DELETE ON "proof_of_plays"
FOR EACH ROW EXECUTE FUNCTION public.wizer_release_proof_of_play_session();

-- ---------------------------------------------------------------------------
-- Partition pre-creation function. The maintenance worker calls this daily.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wizer_ensure_telemetry_partitions(months_ahead INTEGER DEFAULT 6)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  i           INTEGER;
  month_start DATE;
  month_end   DATE;
  part_name   TEXT;
BEGIN
  IF months_ahead < 1 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 1 and 24';
  END IF;

  FOR i IN 0..months_ahead LOOP
    month_start := (date_trunc('month', CURRENT_TIMESTAMP) + make_interval(months => i))::date;
    month_end := (month_start + interval '1 month')::date;

    part_name := format('heartbeats_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF public."heartbeats" FOR VALUES FROM (%L) TO (%L)',
      part_name, month_start::timestamp, month_end::timestamp
    );

    part_name := format('proof_of_plays_y%sm%s', to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF public."proof_of_plays" FOR VALUES FROM (%L) TO (%L)',
      part_name, month_start::timestamp, month_end::timestamp
    );
  END LOOP;
END;
$$;

-- Pre-create/verify the rolling window under the final parent names.
SELECT public.wizer_ensure_telemetry_partitions(6);

COMMIT;
