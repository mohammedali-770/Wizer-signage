-- Retention indexes.
--
-- The nightly retention purge filters each telemetry table by its timestamp
-- (and sometimes status) ALONE. The existing composite indexes all lead with
-- companyId/screenId, so those predicates could not use them and every delete
-- planned as a sequential scan. On a large table that exceeds the pooled
-- statement timeout, the delete fails, and — because the failure used to be
-- swallowed — the job reported "0 deleted" every night while the table grew
-- until writes stopped platform-wide.
--
-- NOTE for a LARGE, live database: a plain CREATE INDEX briefly locks the table
-- against writes. On a fresh/small deployment this is instant. If these tables
-- are already very large, create them manually with CREATE INDEX CONCURRENTLY
-- during low traffic INSTEAD of running this migration (CONCURRENTLY cannot run
-- inside Prisma's migration transaction), then:
--   prisma migrate resolve --applied 20260801100000_retention_indexes

-- Purge predicate: startedAt < cutoff. Existing indexes lead with
-- companyId/screenId and cannot serve a bare startedAt range.
CREATE INDEX "proof_of_plays_startedAt_idx" ON "proof_of_plays"("startedAt");

-- Purge predicate: status IN (RESOLVED, DISMISSED) AND resolvedAt < cutoff.
CREATE INDEX "alerts_status_resolvedAt_idx" ON "alerts"("status", "resolvedAt");

-- Purge predicate: status IN (terminal states) AND createdAt < cutoff.
-- One row per active screen per content/playlist/schedule mutation, so this
-- grows as screens x edits.
CREATE INDEX "device_commands_status_createdAt_idx" ON "device_commands"("status", "createdAt");

-- Purge predicate: revokedAt < cutoff. Sessions were only ever stamped revoked,
-- never removed, so this table grew monotonically with every logout.
CREATE INDEX "sessions_revokedAt_idx" ON "sessions"("revokedAt");

-- Purge predicates for consumed/expired single-use auth material.
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- pairing_codes is written by an UNAUTHENTICATED endpoint, so without pruning
-- an attacker can permanently consume tenant-billed storage with pairing spam.
CREATE INDEX "pairing_codes_expiresAt_idx" ON "pairing_codes"("expiresAt");
