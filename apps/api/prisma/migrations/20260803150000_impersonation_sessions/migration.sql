-- Audited super-admin impersonation.
--
-- Support work inside a tenant previously had no first-class path: a Super
-- Admin's principal carries `companyId = null`, so every `@CurrentCompany`
-- route returned 403 and the only ways to help a customer were ad-hoc
-- super-admin bypasses in individual services or a direct database edit —
-- neither of which leaves a record of WHO acted in WHICH tenant and WHY.
--
-- Impersonation is now an explicit, short-lived, non-refreshable session tagged
-- with the impersonator and a mandatory reason. Because it is an ordinary
-- Session row, it appears in the session list, can be revoked like any other,
-- and expires on its own.
ALTER TABLE "sessions" ADD COLUMN "impersonatorId" TEXT;
ALTER TABLE "sessions" ADD COLUMN "impersonationNote" TEXT;

-- Every open impersonation, cheaply: the security review question is always
-- "who is inside a tenant right now", and this makes it an index scan over a
-- table that is otherwise dominated by ordinary sessions.
CREATE INDEX "sessions_impersonatorId_idx" ON "sessions"("impersonatorId")
  WHERE "impersonatorId" IS NOT NULL;
