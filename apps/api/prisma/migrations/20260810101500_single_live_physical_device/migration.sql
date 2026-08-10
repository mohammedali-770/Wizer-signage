-- A physical Android TV identity may have historical REVOKED rows, but it may
-- never have more than one PENDING/ACTIVE screen binding at the same time.
--
-- DeviceService moves an existing binding transactionally. This partial unique
-- index is the cross-replica backstop when two different pairing codes for the
-- same physical device race on separate API instances.

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "deviceId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "devices"
  WHERE "status" IN ('PENDING', 'ACTIVE')
), revoked AS (
  UPDATE "devices" AS d
  SET
    "status" = 'REVOKED',
    "deviceTokenHash" = NULL,
    "unpairedAt" = COALESCE(d."unpairedAt", CURRENT_TIMESTAMP),
    "updatedAt" = CURRENT_TIMESTAMP
  FROM ranked
  WHERE d."id" = ranked."id"
    AND ranked.rn > 1
  RETURNING d."screenId"
)
UPDATE "screens" AS s
SET
  "status" = 'UNPAIRED',
  "deviceIdentifier" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE s."id" IN (SELECT "screenId" FROM revoked)
  AND s."deletedAt" IS NULL;

-- A pairing code attached to a binding that was de-duplicated above must not
-- continue reporting itself as successfully paired.
UPDATE "pairing_codes" AS pc
SET "status" = 'REVOKED'
WHERE pc."status" IN ('PENDING', 'CLAIMED')
  AND EXISTS (
    SELECT 1
    FROM "devices" AS d
    WHERE d."screenId" = pc."screenId"
      AND d."status" = 'REVOKED'
  );

CREATE UNIQUE INDEX "devices_one_live_binding_per_physical_id_key"
  ON "devices" ("deviceId")
  WHERE "status" IN ('PENDING', 'ACTIVE');
