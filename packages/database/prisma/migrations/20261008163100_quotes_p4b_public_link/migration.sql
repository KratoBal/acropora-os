-- #1582 P4b: the public acceptance link. Only the SHA-256 of the token is
-- stored, one live link per version, and a link acceptance names its link.

-- AlterTable
ALTER TABLE "QuoteAcceptance" ADD COLUMN     "acceptanceLinkId" TEXT;

-- CreateTable
CREATE TABLE "QuoteAcceptanceLink" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "firstOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteAcceptanceLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteAcceptanceLink_tokenHash_key" ON "QuoteAcceptanceLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteAcceptanceLink_quoteVersionId_idx" ON "QuoteAcceptanceLink"("quoteVersionId");

-- CreateIndex
CREATE INDEX "QuoteAcceptanceLink_quoteId_createdAt_idx" ON "QuoteAcceptanceLink"("quoteId", "createdAt");

-- AddForeignKey
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_acceptanceLinkId_fkey" FOREIGN KEY ("acceptanceLinkId") REFERENCES "QuoteAcceptanceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptanceLink" ADD CONSTRAINT "QuoteAcceptanceLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptanceLink" ADD CONSTRAINT "QuoteAcceptanceLink_quoteVersionId_quoteId_fkey" FOREIGN KEY ("quoteVersionId", "quoteId") REFERENCES "QuoteVersion"("id", "quoteId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAcceptanceLink" ADD CONSTRAINT "QuoteAcceptanceLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE UNIQUE INDEX "QuoteAcceptanceLink_one_live_per_version_idx"
 ON "QuoteAcceptanceLink" ("quoteVersionId") WHERE "revokedAt" IS NULL;
-- a link acceptance names its link, and only a link acceptance does
ALTER TABLE "QuoteAcceptance" ADD CONSTRAINT "QuoteAcceptance_link_source_check"
 CHECK (("source" = 'PUBLIC_LINK') = ("acceptanceLinkId" IS NOT NULL));
