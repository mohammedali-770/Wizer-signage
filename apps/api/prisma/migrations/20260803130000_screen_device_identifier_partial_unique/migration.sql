-- Free a deleted screen's device identifier so the physical TV can be re-paired.
--
-- `screens.deviceIdentifier` was globally UNIQUE. Screen deletion is a SOFT
-- delete, so the row — and its identifier — survived. The consequences:
--
--   1. Deleting a screen left the paired device's token valid, so the TV kept
--      polling a screen the customer believes is gone.
--   2. The identifier stayed reserved forever, so pairing that same TV to a NEW
--      screen failed with a unique violation. The only recovery was a manual
--      database edit — for what is otherwise the most ordinary support flow
--      there is ("this TV moved to a different store").
--
-- Uniqueness still holds where it matters: at most one LIVE screen may claim a
-- given device identifier. Deleted screens keep theirs for audit.
DROP INDEX IF EXISTS "screens_deviceIdentifier_key";

CREATE UNIQUE INDEX "screens_deviceIdentifier_live_key"
  ON "screens"("deviceIdentifier")
  WHERE "deletedAt" IS NULL;
