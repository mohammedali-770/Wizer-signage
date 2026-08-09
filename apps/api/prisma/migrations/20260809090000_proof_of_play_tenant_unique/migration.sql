-- playbackSessionId is device-supplied. A global unique index lets one tenant
-- pre-claim another tenant's future idempotency key and is stricter than the
-- service's actual ownership boundary. Scope uniqueness to companyId while
-- preserving idempotency within a tenant.
--
-- Build the replacement first so the table never has a window with no useful
-- duplicate protection. Prisma executes migrations in a transaction, so
-- CREATE/DROP INDEX CONCURRENTLY is not legal here (Postgres 25001). The
-- existing global UNIQUE constraint means this replacement cannot encounter a
-- duplicate that was previously allowed. At the current pre-scale stage the
-- brief write lock is preferable to an unreproducible out-of-band migration.
CREATE UNIQUE INDEX "proof_of_plays_companyId_playbackSessionId_key"
  ON "proof_of_plays"("companyId", "playbackSessionId");

DROP INDEX "proof_of_plays_playbackSessionId_key";
