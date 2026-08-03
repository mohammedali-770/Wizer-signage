-- Protect financial + compliance records from an accidental company delete.
--
-- These four FKs were ON DELETE CASCADE, which contradicted both the retention
-- service ("FINANCIAL records are NEVER touched") and docs/data-retention.md:
-- both statements were true of the application and false of the database.
--
-- `DELETE FROM companies WHERE id = '...'` in Supabase Studio — the natural
-- operator reflex for a churned tenant — silently erased every invoice, the
-- subscription, and the tenant's entire proof-of-play history. Deleting a single
-- screen erased that screen's billing-grade playback record.
--
-- RESTRICT makes the database refuse instead. Purging a tenant is now a
-- deliberate, ordered operation (archive financials first), not one keystroke.
--
-- NOTE: this migration will FAIL if orphaned/inconsistent rows already violate
-- the constraint — that cannot happen here because CASCADE guaranteed referential
-- integrity, so every child row has a live parent.

ALTER TABLE "proof_of_plays" DROP CONSTRAINT "proof_of_plays_companyId_fkey";
ALTER TABLE "proof_of_plays" ADD CONSTRAINT "proof_of_plays_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proof_of_plays" DROP CONSTRAINT "proof_of_plays_screenId_fkey";
ALTER TABLE "proof_of_plays" ADD CONSTRAINT "proof_of_plays_screenId_fkey"
  FOREIGN KEY ("screenId") REFERENCES "screens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_companyId_fkey";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_companyId_fkey";
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
