-- A MEGRENDELÉSEK BEÁLLÍTÁSA (S4b, kártya 38caeac2): egy új, üres tábla, meglévő sort nem érint. Sor nélkül az alapérték
-- (14 nap) érvényes, tehát a telepítés után semmit nem kell betölteni. A teljes indoklás a sémában áll.

-- CreateTable
CREATE TABLE "PartnerOrderSetting" (
    "id" TEXT NOT NULL,
    "backlogDays" INTEGER NOT NULL DEFAULT 14,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerOrderSetting_pkey" PRIMARY KEY ("id")
);
