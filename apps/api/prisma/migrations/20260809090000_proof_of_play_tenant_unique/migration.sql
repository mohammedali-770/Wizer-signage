-- playbackSessionId is device-supplied. A global unique index lets one tenant
-- pre-claim another tenant's future idempotency key and is stricter than the
-- service's actual ownership boundary. Scope uniqueness to companyId while
-- preserving idempotency within a tenant.
--
-- Build the replacement first so the table never has a window with no useful
-- duplicate protection. CONCURRENTLY follows the existing high-volume-index
-- migration pattern and avoids blocking proof-of-play ingest on production.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "proof_of_plays_companyId_playbackSessionId_key"
  ON "proof_of_plays"("companyId", "playbackSessionId");

DROP INDEX CONCURRENTLY IF EXISTS "proof_of_plays_playbackSessionId_key";
