# Telemetry monthly partitioning

Wizer stores its two highest-volume append-heavy datasets — `heartbeats` and `proof_of_plays` — in PostgreSQL RANGE partitions by month.

## Why this is custom SQL

The repository currently uses Prisma 5.22. Prisma can query PostgreSQL partitioned tables but its schema language cannot represent partitioning itself, so the physical layout is owned by the customized migration `20260809120000_partition_telemetry`. The application models remain the logical row contract; PostgreSQL owns routing, child tables, and the cross-partition proof-of-play idempotency registry.

## One-time conversion

The migration converts the existing unpartitioned tables before Wizer production launch:

1. Takes `ACCESS EXCLUSIVE` locks on both telemetry tables so writes cannot fall between copy and swap.
2. Backfills `proof_of_play_session_keys` from the already tenant-unique source table.
3. Creates partitioned replacements and every historic month currently represented in the data, plus six months ahead.
4. Copies rows and verifies source/destination row counts.
5. Atomically renames the new parents into the canonical table names and removes the temporary source tables.
6. Installs proof-of-play idempotency triggers and the rolling partition-maintenance function.

This conversion is intentionally optimized for **the current pre-production/testing phase**. Do not defer it until the tables contain production-scale history: the copy/swap is a maintenance operation and is deliberately not advertised as an online zero-downtime migration.

## Partition keys

- `heartbeats`: RANGE on `createdAt`
- `proof_of_plays`: RANGE on `startedAt`

Each partition covers one UTC calendar-month boundary. The API already clamps/rejects implausible proof-of-play timestamps, and heartbeat `createdAt` is server-generated, so normal writes stay in the prepared range.

## Proof-of-play idempotency across months

PostgreSQL cannot enforce a unique constraint on a partitioned table unless the unique key includes every partition key column. Adding `startedAt` to `(companyId, playbackSessionId)` would weaken the product invariant because the same client session ID could be replayed with a different timestamp.

Wizer therefore keeps `proof_of_play_session_keys` **unpartitioned** with primary key:

`(companyId, playbackSessionId)`

A `BEFORE INSERT` trigger claims that key before a proof-of-play event is accepted. A duplicate raises PostgreSQL unique violation, preserving the Prisma/service race path already used for idempotent ingestion. An `AFTER DELETE` trigger releases the exact key when retention deletes the retained event, preventing ghost idempotency rows.

The registry also stores `proofOfPlayId`, `screenId`, and `startedAt` for audit/maintenance diagnostics.

## Rolling partition creation

The migration creates `public.wizer_ensure_telemetry_partitions(months_ahead)` and initially prepares six months ahead.

The maintenance worker runs `scripts/ensure-telemetry-partitions.sh` every day at 00:15 UTC. Default lead time is six months and can be changed with `TELEMETRY_PARTITION_MONTHS_AHEAD` (1–24).

The job is idempotent and fails non-zero if database access or partition creation fails, so the maintenance container log provides months of warning before an uncovered boundary can affect ingestion.

## Retention and backup/restore

Existing Prisma `findMany`/`deleteMany` retention calls continue to address the partition parent and therefore include child partitions. Deleting proof-of-play rows fires the registry-release trigger automatically.

`pg_dump --schema=public` includes partition parents, children, trigger functions, and the registry. The existing real PostgreSQL backup/restore drill remains the required recovery gate for this migration.

Future optimization can drop whole expired partitions when all tenants share the same retention boundary. Wizer currently supports plan-specific retention windows, so row-level retention remains the correctness-first path.

## Validation gate

`apps/api/test/telemetry-partitioning.e2e-spec.ts` runs in the existing real-Postgres e2e job and verifies:

- both canonical parents are RANGE-partitioned;
- current and next-month child partitions exist;
- the idempotency registry is an ordinary unpartitioned table;
- registry primary key is `(companyId, playbackSessionId)`;
- claim/release triggers are installed;
- a duplicate session across two different monthly partitions surfaces through Prisma's expected unique-conflict path;
- deleting the retained event releases the registry key and permits reuse;
- registry/event counts remain in lock-step after the test cleanup.

Do not merge the partition migration until this real PostgreSQL test, migration apply, backup/restore drill, and the repository's Prisma drift gate have all run successfully on the final branch head.
