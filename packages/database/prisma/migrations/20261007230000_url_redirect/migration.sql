-- SEO P0 PR 6: az atiranyitas-tabla (terv: exchange/seo/seo-pr6-terv-2026-10-07.md,
-- D1-D2; a P0 terv C5 resze).
--
-- Egy sor egy regi cim 301-e. A `sourcePath` a normalizalt ut, domain nelkul; a
-- `sourcePathLower` egyedi, tehat ket csak betumeretben eltero forras nem allhat
-- (D2). A lancot az iro vonja ossze, tehat egy aktiv szabaly celja sem forras.
--
-- A DDL betura a `prisma migrate diff` kimenete. Adatot ez a migracio nem ir: a
-- regi UNAS-termekcimek szabalyait a `redirect-backfill` CLI adja, szarazfutas utan.

-- CreateEnum
CREATE TYPE "RedirectReason" AS ENUM ('UNAS_PRODUCT', 'UNAS_CATEGORY', 'SLUG_CHANGE', 'MANUAL');

-- CreateTable
CREATE TABLE "UrlRedirect" (
    "id" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourcePathLower" TEXT NOT NULL,
    "destinationPath" TEXT NOT NULL,
    "httpStatus" INTEGER NOT NULL DEFAULT 301,
    "reason" "RedirectReason" NOT NULL,
    "entityType" "SlugEntityType",
    "entityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrlRedirect_sourcePath_key" ON "UrlRedirect"("sourcePath");

-- CreateIndex
CREATE UNIQUE INDEX "UrlRedirect_sourcePathLower_key" ON "UrlRedirect"("sourcePathLower");

-- CreateIndex
CREATE INDEX "UrlRedirect_destinationPath_idx" ON "UrlRedirect"("destinationPath");

-- CreateIndex
CREATE INDEX "UrlRedirect_entityType_entityId_idx" ON "UrlRedirect"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "UrlRedirect" ADD CONSTRAINT "UrlRedirect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

