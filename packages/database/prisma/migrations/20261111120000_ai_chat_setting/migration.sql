-- AZ AI CSEVEGÉS BEÁLLÍTÁSA (kártya f5b8f7ba, 4a szelet): egy új, üres tábla, meglévő sort nem érint. Sor nélkül az alapérték
-- (180 / 30 / 90 nap, a kapcsolat-kérés kikapcsolva) érvényes, tehát a telepítés után semmit nem kell betölteni. A teljes
-- indoklás a sémában áll. A CHECK-ek a szerver határait ismétlik meg az adatbázisban is: egy elgépelt 0 ne törölhessen azonnal.

-- CreateTable
CREATE TABLE "AiChatSetting" (
    "id" TEXT NOT NULL,
    "offerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "contactRequestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "contactRecipientEmail" TEXT,
    "messageRetentionDays" INTEGER NOT NULL DEFAULT 180,
    "contactHandledRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "contactUnhandledRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChatSetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiChatSetting_messageRetentionDays_range" CHECK ("messageRetentionDays" BETWEEN 7 AND 365),
    CONSTRAINT "AiChatSetting_contactHandledRetentionDays_range" CHECK ("contactHandledRetentionDays" BETWEEN 7 AND 180),
    CONSTRAINT "AiChatSetting_contactUnhandledRetentionDays_range" CHECK ("contactUnhandledRetentionDays" BETWEEN 7 AND 180),
    CONSTRAINT "AiChatSetting_contact_unhandled_not_shorter" CHECK ("contactUnhandledRetentionDays" >= "contactHandledRetentionDays")
);
