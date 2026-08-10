-- =============================================================================
-- Keep Prisma-owned telemetry parents in public; move PostgreSQL-only internals
-- into a dedicated schema so normal public-schema drift detection stays strict.
-- =============================================================================
--
-- Prisma models `public.heartbeats` and `public.proof_of_plays`, including their
-- composite parent primary keys. PostgreSQL owns the monthly child partitions,
-- proof-of-play session-key registry, triggers and partition-maintenance helper.
-- Those objects are implementation details, not Prisma Client models.
--
-- This migration is deliberately ADDITIVE after the copy/swap conversion. It
-- never rewrites telemetry data; ALTER TABLE ... SET SCHEMA changes namespace
-- metadata for child/registry relations and keeps the parent partition links.

CREATE SCHEMA IF NOT EXISTS wizer_telemetry;

-- 1. Move every existing child partition of the two public parents. Do not
-- hard-code month names: historical/future children created by the conversion
-- are discovered from pg_inherits.
DO $$
DECLARE
  child_oid oid;
BEGIN
  FOR child_oid IN
    SELECT i.inhrelid
    FROM pg_inherits AS i
    WHERE i.inhparent IN (
      'public.heartbeats'::regclass,
      'public.proof_of_plays'::regclass
    )
  LOOP
    EXECUTE format(
      'ALTER TABLE %s SET SCHEMA wizer_telemetry',
      child_oid::regclass
    );
  END LOOP;
END
$$;

-- 2. The global tenant/session idempotency registry is intentionally NOT a
-- Prisma model. Its PK is enforced by PostgreSQL trigger functions on the
-- partitioned proof_of_plays parent.
ALTER TABLE IF EXISTS public.proof_of_play_session_keys
  SET SCHEMA wizer_telemetry;

-- 3. Existing PoP trigger functions use the registry by its unqualified table
-- name. Pin only the functions whose definitions actually reference that table
-- so moving the registry cannot break inserts/deletes and unrelated triggers are
-- untouched.
DO $$
DECLARE
  fn_oid oid;
BEGIN
  FOR fn_oid IN
    SELECT DISTINCT p.oid
    FROM pg_trigger AS t
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.proof_of_plays'::regclass
      AND NOT t.tgisinternal
      AND pg_get_functiondef(p.oid) ILIKE '%proof_of_play_session_keys%'
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = wizer_telemetry, public',
      fn_oid::regprocedure
    );
  END LOOP;
END
$$;

-- 4. Future monthly children must also be created in the internal schema. The
-- existing helper creates unqualified child names; a function-level search_path
-- therefore controls the CREATE TABLE namespace while still resolving the
-- parents from public. Keep the function itself in public for compatibility with
-- the existing maintenance script and any in-flight release during cutover.
DO $$
DECLARE
  fn_oid oid;
BEGIN
  SELECT p.oid
  INTO fn_oid
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'wizer_ensure_telemetry_partitions'
    AND pg_get_function_identity_arguments(p.oid) = 'months_ahead integer'
  LIMIT 1;

  IF fn_oid IS NULL THEN
    RAISE EXCEPTION 'public.wizer_ensure_telemetry_partitions(integer) is missing';
  END IF;

  EXECUTE format(
    'ALTER FUNCTION %s SET search_path = wizer_telemetry, public',
    fn_oid::regprocedure
  );
END
$$;

-- 5. Exercise the helper once after changing its search_path. This both creates
-- the rolling future window and proves at migration time that the helper still
-- resolves its parents/DDL dependencies. Existing partitions are IF NOT EXISTS.
SELECT public.wizer_ensure_telemetry_partitions(3);

-- 6. Fail the migration if the helper or the namespace move left ANY child in
-- public. This prevents a quietly-mixed layout from becoming the new baseline.
DO $$
DECLARE
  public_children integer;
  registry_schema text;
BEGIN
  SELECT count(*)::integer
  INTO public_children
  FROM pg_inherits AS i
  JOIN pg_class AS c ON c.oid = i.inhrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE i.inhparent IN (
      'public.heartbeats'::regclass,
      'public.proof_of_plays'::regclass
    )
    AND n.nspname <> 'wizer_telemetry';

  IF public_children <> 0 THEN
    RAISE EXCEPTION 'telemetry partition isolation failed: % child partition(s) outside wizer_telemetry', public_children;
  END IF;

  SELECT n.nspname
  INTO registry_schema
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE c.relname = 'proof_of_play_session_keys'
    AND c.relkind = 'r';

  IF registry_schema IS DISTINCT FROM 'wizer_telemetry' THEN
    RAISE EXCEPTION 'proof_of_play_session_keys registry is not isolated in wizer_telemetry';
  END IF;
END
$$;
