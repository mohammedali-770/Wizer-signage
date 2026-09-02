# Telemetry monthly partitioning

Wizer stores its two highest-volume append-heavy datasets — `heartbeats` and `proof_of_plays` — in PostgreSQL RANGE partitions by month.

## Ownership boundary

The repository currently uses Prisma 5.22. Prisma can query PostgreSQL partitioned tables but its schema language cannot model partitioning itself, so Wizer uses a deliberate two-schema ownership boundary:

- `public.heartbeats` and `public.proof_of_plays` are the canonical Prisma-visible partition parents.
- Monthly child partitions and the proof-of-play idempotency registry live in `wizer_telemetry`.
- Prisma models the physical composite parent primary keys; PostgreSQL owns partition routing, child tables, triggers, registry behavior, and partition-maintenance functions.

This keeps normal Prisma/public-schema drift strict instead of hiding unsupported PostgreSQL objects behind a broad drift waiver.

## One-time conversion

Migration `20260809120000_partition_telemetry` converts the existing unpartitioned tables before Wizer production launch:

1. Takes `ACCESS EXCLUSIVE` locks on both telemetry tables so writes cannot fall between copy and swap.
2. Backfills `proof_of_play_session_keys` from the already tenant-unique source table.
3. Creates partitioned replacements and every historic month represented in the data, plus six months ahead.
4. Copies rows and verifies source/destination row counts.
5. Atomically renames the new parents into the canonical table names and removes the temporary source tables.
6. Installs proof-of-play idempotency triggers and the rolling partition-maintenance function.

Follow-up migration `20260809123000_isolate_telemetry_partition_internals` then creates `wizer_telemetry`, moves every child partition and the session registry there, pins trigger/helper search paths to `wizer_telemetry, public`, exercises future partition creation, and fails if any PostgreSQL-owned child remains in the wrong schema.

The conversion is intentionally optimized for the current pre-production/testing phase. Do not defer it until the tables contain production-scale history: the copy/swap is a maintenance operation and is deliberately not advertised as an online zero-downtime migration.

## Partition keys

- `heartbeats`: RANGE on `createdAt`; parent primary key `(id, createdAt)`.
- `proof_of_plays`: RANGE on `startedAt`; parent primary key `(id, startedAt)`.

Each child covers one UTC calendar month. The API already clamps/rejects implausible proof-of-play timestamps, and heartbeat `createdAt` is server-generated, so normal writes stay inside the prepared range.

## Proof-of-play idempotency across months

PostgreSQL cannot enforce a unique constraint on a partitioned table unless the unique key includes every partition-key column. Adding `startedAt` to `(companyId, playbackSessionId)` would weaken the product invariant because the same client session could be replayed with a different timestamp.

Wizer therefore keeps `wizer_telemetry.proof_of_play_session_keys` unpartitioned with primary key:

`(companyId, playbackSessionId)`

A `BEFORE INSERT` trigger claims that key before a proof-of-play event is accepted. A duplicate raises PostgreSQL unique violation, preserving the service's existing idempotent-create race path. An `AFTER DELETE` trigger releases the exact key when retention deletes the retained event, preventing ghost idempotency rows.

The registry also stores `proofOfPlayId`, `screenId`, and `startedAt` for audit/maintenance diagnostics.

## Rolling partition creation

The public compatibility function `public.wizer_ensure_telemetry_partitions(months_ahead)` resolves new child tables into `wizer_telemetry` through its pinned search path. The migration initially prepares six months ahead.

The maintenance container runs `scripts/ensure-telemetry-partitions.sh` every day at 00:15 UTC under its own non-blocking `flock` lock. Default lead time is six months and can be changed with `TELEMETRY_PARTITION_MONTHS_AHEAD` (1–24).

The job is idempotent and fails non-zero if database access or partition creation fails, giving operations months of warning before an uncovered boundary can affect ingestion.

## Retention

Existing Prisma `findMany`/`deleteMany` retention calls continue to address the partition parents and therefore include their children. Deleting proof-of-play rows fires the registry-release trigger automatically.

Wizer supports plan-specific retention windows, so globally dropping a whole monthly child can delete rows that another tenant is still entitled to retain. Row-level retention therefore remains the correctness-first behavior. Whole-partition drops are only a future optimization if retention boundaries become globally compatible.

## Backup and restore

A complete Wizer logical backup must include **both** Wizer-owned schemas:

```bash
pg_dump ... --schema=public --schema=wizer_telemetry
```

`public` contains business data and the canonical partition parents; `wizer_telemetry` contains monthly child data and cross-partition idempotency state. A `public`-only dump after partitioning is incomplete even if `pg_dump` exits successfully.

`scripts/backup-db.sh` pins both schema selectors. `scripts/tests/backup-db.test.sh` asserts both are passed to `pg_dump`, and the real Docker `scripts/tests/backup-restore-drill.sh` creates an internal-schema probe, removes it, restores the dump, and requires the internal object/data to come back.

After any production restore, run both read-only physical checks:

```bash
DIRECT_URL="$DIRECT_URL" bash scripts/assert-telemetry-partitions.sh
DIRECT_URL="$DIRECT_URL" bash scripts/assert-telemetry-partition-isolation.sh
```

## Validation gate

The final PR must run against real PostgreSQL 17 and prove all of the following on the exact release head:

- full migration chain applies from an empty database;
- Prisma client generation succeeds and the normal schema-drift gate remains strict;
- both canonical parents are RANGE partitioned with the expected composite primary keys;
- every child partition lives in `wizer_telemetry`;
- current and next-month children exist;
- the global session registry has primary key `(companyId, playbackSessionId)`;
- claim/release triggers and helper search paths are correct;
- a duplicate session across different months follows the expected unique-conflict path;
- deleting the retained event releases the registry key and permits reuse;
- backup and restore preserve both Wizer-owned schemas;
- both physical verifier scripts pass after restore.

Do not merge the partitioning work to `main` until those real-Postgres, drift, e2e, backup/restore, and physical-schema checks have genuinely executed and passed.
