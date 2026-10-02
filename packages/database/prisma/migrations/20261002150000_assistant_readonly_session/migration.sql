CREATE TYPE "SessionKind" AS ENUM ('USER', 'ASSISTANT_READONLY');
ALTER TABLE "Session" ADD COLUMN "kind" "SessionKind" NOT NULL DEFAULT 'USER';
CREATE INDEX "Session_userId_kind_expiresAt_idx" ON "Session"("userId", "kind", "expiresAt");
