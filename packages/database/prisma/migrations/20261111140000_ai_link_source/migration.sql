-- AZ AI CSEVEGÉS TÁROLT LINK-FORRÁSAI (kártya 9d060f5c): egy új, üres tábla és egy új enum, meglévő sort nem érint. Üres
-- listával az AI válasz-kapujának egyik kivétele sem aktív, tehát a telepítés után semmit nem kell betölteni. A teljes
-- indoklás a sémában áll. A CHECK-ek a szerver szabályát ismétlik meg: a host kisbetűs és nincs benne séma, útvonal
-- vagy port; gyártói dokumentumnak márka kell, hatóságnak nem lehet.

-- CreateEnum
CREATE TYPE "AiLinkSourceCategory" AS ENUM ('MANUFACTURER_DOCUMENT', 'AUTHORITY');

-- CreateTable
CREATE TABLE "AiLinkSource" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "category" "AiLinkSourceCategory" NOT NULL,
    "brand" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiLinkSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiLinkSource_host_shape" CHECK ("host" = lower("host") AND "host" ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
    CONSTRAINT "AiLinkSource_brand_by_category" CHECK (
        ("category" = 'MANUFACTURER_DOCUMENT' AND "brand" IS NOT NULL AND length(btrim("brand")) > 0)
        OR ("category" = 'AUTHORITY' AND "brand" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "AiLinkSource_host_key" ON "AiLinkSource"("host");
