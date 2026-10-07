-- SEO P0 PR 5: a termek webshop-slugja es a slug-elozmeny (terv:
-- exchange/seo/seo-pr5-terv-2026-10-07.md, D1-D3; a P0 terv C4 resze).
--
-- A slug egy uj csatorna-sorban el: `ChannelListing(channel = WEBSHOP).slug`. A mai
-- UNAS-sor marad, tehat a regi es az uj cim egy termek ket csatorna-soraban all, es
-- ebbol general a PR 6 atiranyitast. A `SlugHistory` a lecserelt slugokat tartja:
-- egy regi cim soha nem kaphat uj tulajdonost.
--
-- A DDL betura a `prisma migrate diff` kimenete. Az uj enum-ertek (`WEBSHOP`) ebben a
-- tranzakcioban meg nem hasznalhato, ezert a reszleges egyedi index, ami ra szur,
-- kulon migracio (20261007220100), ahogy a PR 4-nel. Adatot ez a migracio nem ir:
-- a slugokat a `slug-backfill` CLI adja, szarazfutas utan.

-- CreateEnum
CREATE TYPE "SlugEntityType" AS ENUM ('PRODUCT', 'STORE_CATEGORY', 'BRAND', 'LANDING_PAGE');

-- AlterEnum
ALTER TYPE "CatalogChannel" ADD VALUE 'WEBSHOP';

-- CreateTable
CREATE TABLE "SlugHistory" (
    "id" TEXT NOT NULL,
    "entityType" "SlugEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedById" TEXT,

    CONSTRAINT "SlugHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SlugHistory_entityType_entityId_idx" ON "SlugHistory"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SlugHistory_entityType_slug_key" ON "SlugHistory"("entityType", "slug");

-- AddForeignKey
ALTER TABLE "SlugHistory" ADD CONSTRAINT "SlugHistory_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

