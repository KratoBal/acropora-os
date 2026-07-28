-- Move session storage off the API's in-memory Map onto the existing
-- Session table: the session token itself is never persisted, only its
-- SHA-256 hash, so a leaked database dump does not yield usable Bearer
-- tokens.
--
-- Any rows already in "Session" predate this column and were never
-- actually written by the application (the old AuthService kept sessions
-- exclusively in memory and never touched this table), so there is
-- nothing meaningful to backfill. They are cleared so the NOT NULL and
-- UNIQUE constraints below can be applied cleanly; any such stale row
-- would have been unusable anyway, since the plain-text token needed to
-- resolve it was never stored anywhere.
DELETE FROM "Session";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "tokenHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
