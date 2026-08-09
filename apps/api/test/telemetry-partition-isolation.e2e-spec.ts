import { PrismaClient } from '@prisma/client';

type Row<T extends string> = Record<T, string | number | bigint | boolean | null>;

const prisma = new PrismaClient();

function suffix(date: Date): string {
  return `${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

describe('telemetry partition PostgreSQL ownership boundary', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps only the Prisma-owned partition parents in public', async () => {
    const rows = await prisma.$queryRaw<Array<Row<'relname' | 'relkind' | 'schema'>>>
      `SELECT c.relname,
              c.relkind::text AS relkind,
              n.nspname AS schema
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid IN ('public.heartbeats'::regclass, 'public.proof_of_plays'::regclass)
        ORDER BY c.relname`;

    expect(rows).toEqual([
      { relname: 'heartbeats', relkind: 'p', schema: 'public' },
      { relname: 'proof_of_plays', relkind: 'p', schema: 'public' },
    ]);
  });

  it('places every current telemetry child partition in wizer_telemetry', async () => {
    const rows = await prisma.$queryRaw<Array<Row<'parent' | 'child' | 'schema'>>>
      `SELECT parent.relname AS parent,
              child.relname AS child,
              child_ns.nspname AS schema
         FROM pg_inherits i
         JOIN pg_class parent ON parent.oid = i.inhparent
         JOIN pg_class child ON child.oid = i.inhrelid
         JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        WHERE i.inhparent IN ('public.heartbeats'::regclass, 'public.proof_of_plays'::regclass)
        ORDER BY parent.relname, child.relname`;

    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((row) => row.schema === 'wizer_telemetry')).toBe(true);
  });

  it('keeps the global PoP tenant-session registry internal with the exact primary key', async () => {
    const registry = await prisma.$queryRaw<Array<Row<'schema' | 'relkind'>>>
      `SELECT n.nspname AS schema, c.relkind::text AS relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = 'wizer_telemetry.proof_of_play_session_keys'::regclass`;
    expect(registry).toEqual([{ schema: 'wizer_telemetry', relkind: 'r' }]);

    const pk = await prisma.$queryRaw<Array<Row<'columns'>>>
      `SELECT string_agg(a.attname, ',' ORDER BY u.ordinality) AS columns
         FROM pg_constraint con
         CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS u(attnum, ordinality)
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = u.attnum
        WHERE con.conrelid = 'wizer_telemetry.proof_of_play_session_keys'::regclass
          AND con.contype = 'p'`;
    expect(pk).toEqual([{ columns: 'companyId,playbackSessionId' }]);
  });

  it('pins registry trigger functions and partition helper to the internal-first search_path', async () => {
    const triggerFunctions = await prisma.$queryRaw<Array<Row<'name' | 'configured'>>>
      `SELECT p.proname AS name,
              ('search_path=wizer_telemetry, public' = ANY(COALESCE(p.proconfig, ARRAY[]::text[]))) AS configured
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.proof_of_plays'::regclass
          AND NOT t.tgisinternal
          AND pg_get_functiondef(p.oid) ILIKE '%proof_of_play_session_keys%'
        ORDER BY p.proname`;
    expect(triggerFunctions.length).toBeGreaterThanOrEqual(2);
    expect(triggerFunctions.every((row) => row.configured === true)).toBe(true);

    const helper = await prisma.$queryRaw<Array<Row<'configured'>>>
      `SELECT ('search_path=wizer_telemetry, public' = ANY(COALESCE(p.proconfig, ARRAY[]::text[]))) AS configured
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'wizer_ensure_telemetry_partitions'
          AND pg_get_function_identity_arguments(p.oid) = 'months_ahead integer'`;
    expect(helper).toEqual([{ configured: true }]);
  });

  it('has current and next-month partitions ready for both telemetry parents', async () => {
    const now = new Date();
    for (const month of [now, nextMonth(now)]) {
      const monthSuffix = suffix(month);
      const rows = await prisma.$queryRaw<Array<Row<'heartbeat' | 'proof'>>>
        `SELECT to_regclass(${`wizer_telemetry.heartbeats_${monthSuffix}`}) IS NOT NULL AS heartbeat,
                to_regclass(${`wizer_telemetry.proof_of_plays_${monthSuffix}`}) IS NOT NULL AS proof`;
      expect(rows).toEqual([{ heartbeat: true, proof: true }]);
    }
  });
});
