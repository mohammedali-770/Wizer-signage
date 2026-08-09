import { randomUUID } from 'node:crypto';

import { PrismaClient, ProofOfPlayStatus } from '@prisma/client';

const prisma = new PrismaClient();

describe('telemetry partitioning (real PostgreSQL)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uses RANGE partitioned parents for heartbeats and proof-of-play', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; strategy: string }>>`
      SELECT c.relname AS table_name, pt.partstrat::text AS strategy
        FROM pg_partitioned_table pt
        JOIN pg_class c ON c.oid = pt.partrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('heartbeats', 'proof_of_plays')
       ORDER BY c.relname
    `;

    expect(rows).toEqual([
      { table_name: 'heartbeats', strategy: 'r' },
      { table_name: 'proof_of_plays', strategy: 'r' },
    ]);
  });

  it('normalizes parent constraint/index names after the temporary-table swap', async () => {
    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name
        FROM pg_constraint
       WHERE conrelid IN ('public.heartbeats'::regclass, 'public.proof_of_plays'::regclass)
       ORDER BY conname
    `;
    const constraintNames = new Set(constraints.map((row) => row.name));
    for (const name of [
      'heartbeats_pkey',
      'heartbeats_screenId_fkey',
      'heartbeats_companyId_fkey',
      'proof_of_plays_pkey',
      'proof_of_plays_screenId_fkey',
      'proof_of_plays_companyId_fkey',
    ]) {
      expect(constraintNames).toContain(name);
    }
    expect([...constraintNames].some((name) => name.includes('_partitioned_'))).toBe(false);

    const indexes = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT indexname AS name
        FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename IN ('heartbeats', 'proof_of_plays')
    `;
    const indexNames = indexes.map((row) => row.name);
    expect(indexNames).toContain('heartbeats_screenId_createdAt_idx');
    expect(indexNames).toContain('proof_of_plays_companyId_playbackSessionId_idx');
    expect(indexNames.some((name) => name.includes('_partitioned_'))).toBe(false);
  });

  it('has current and next-month children for both high-volume parents', async () => {
    await prisma.$queryRaw`SELECT public.wizer_ensure_telemetry_partitions(2)`;

    const rows = await prisma.$queryRaw<Array<{ parent: string; child: string }>>`
      SELECT parent.relname AS parent, child.relname AS child
        FROM pg_inherits i
        JOIN pg_class parent ON parent.oid = i.inhparent
        JOIN pg_class child ON child.oid = i.inhrelid
        JOIN pg_namespace n ON n.oid = parent.relnamespace
       WHERE n.nspname = 'public'
         AND parent.relname IN ('heartbeats', 'proof_of_plays')
    `;

    const names = new Set(rows.map((row) => row.child));
    for (let offset = 0; offset <= 1; offset++) {
      const date = new Date();
      const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
      const suffix = `${month.getUTCFullYear()}m${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
      expect(names).toContain(`heartbeats_y${suffix}`);
      expect(names).toContain(`proof_of_plays_y${suffix}`);
    }
  });

  it('keeps cross-partition proof-of-play idempotency in an unpartitioned registry', async () => {
    const registry = await prisma.$queryRaw<Array<{ relkind: string }>>`
      SELECT c.relkind::text AS relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname = 'proof_of_play_session_keys'
    `;
    expect(registry).toEqual([{ relkind: 'r' }]);

    const pk = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
       WHERE con.conrelid = 'public.proof_of_play_session_keys'::regclass
         AND con.contype = 'p'
    `;
    expect(pk).toHaveLength(1);
    expect(pk[0]?.definition).toContain('"companyId", "playbackSessionId"');

    const triggers = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT tgname AS name
        FROM pg_trigger
       WHERE tgrelid = 'public.proof_of_plays'::regclass
         AND NOT tgisinternal
       ORDER BY tgname
    `;
    expect(triggers.map((row) => row.name)).toEqual(
      expect.arrayContaining(['proof_of_plays_claim_session', 'proof_of_plays_release_session']),
    );
  });

  it('surfaces a cross-month duplicate session through Prisma and releases the key on delete', async () => {
    const suffix = randomUUID().slice(0, 8);
    const company = await prisma.company.create({
      data: { name: `Partition test ${suffix}`, slug: `partition-test-${suffix}` },
      select: { id: true },
    });
    const screen = await prisma.screen.create({
      data: { companyId: company.id, name: `Partition screen ${suffix}` },
      select: { id: true },
    });
    const session = randomUUID();
    const firstStart = new Date(Date.UTC(2026, 7, 20, 12, 0, 0));
    const secondStart = new Date(Date.UTC(2026, 8, 2, 12, 0, 0));

    try {
      const first = await prisma.proofOfPlay.create({
        data: {
          companyId: company.id,
          screenId: screen.id,
          startedAt: firstStart,
          status: ProofOfPlayStatus.STARTED,
          playbackSessionId: session,
        },
        select: { id: true },
      });

      await expect(
        prisma.proofOfPlay.create({
          data: {
            companyId: company.id,
            screenId: screen.id,
            startedAt: secondStart,
            status: ProofOfPlayStatus.STARTED,
            playbackSessionId: session,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });

      await prisma.proofOfPlay.deleteMany({ where: { id: first.id } });

      // AFTER DELETE releases the global session key. Reusing it after the
      // retained event is actually gone must succeed (retention semantics).
      await expect(
        prisma.proofOfPlay.create({
          data: {
            companyId: company.id,
            screenId: screen.id,
            startedAt: secondStart,
            status: ProofOfPlayStatus.STARTED,
            playbackSessionId: session,
          },
        }),
      ).resolves.toMatchObject({ playbackSessionId: session });
    } finally {
      await prisma.proofOfPlay.deleteMany({ where: { companyId: company.id } });
      await prisma.screen.deleteMany({ where: { id: screen.id } });
      await prisma.company.deleteMany({ where: { id: company.id } });
    }
  });

  it('backfill registry and event table counts stay in lock-step', async () => {
    const [row] = await prisma.$queryRaw<Array<{ events: bigint; keys: bigint }>>`
      SELECT
        (SELECT COUNT(*) FROM public.proof_of_plays) AS events,
        (SELECT COUNT(*) FROM public.proof_of_play_session_keys) AS keys
    `;
    expect(row).toBeDefined();
    expect(row!.keys).toBe(row!.events);
  });
});
