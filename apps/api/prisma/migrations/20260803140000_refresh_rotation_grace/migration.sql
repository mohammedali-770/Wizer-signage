-- Refresh-token rotation grace window.
--
-- Refresh rotates the stored hash immediately, and any presentation of a
-- non-matching token revokes the ENTIRE session as suspected theft. That is the
-- correct response to real reuse — but it also fires on the ordinary case where
-- the client never received the rotated token: a dropped response, the app being
-- killed mid-request, or two browser tabs refreshing at the same moment. The
-- user is silently logged out, and the audit trail says "refresh_reuse_detected"
-- as though they had been attacked.
--
-- Remembering the immediately-previous hash, valid for a few seconds after
-- rotation, distinguishes "the client did not get my answer" from "someone is
-- replaying a stolen token from an hour ago". Anything older, or any token older
-- than one generation, still kills the session.
ALTER TABLE "sessions" ADD COLUMN "previousRefreshTokenHash" TEXT;
ALTER TABLE "sessions" ADD COLUMN "refreshRotatedAt" TIMESTAMP(3);
