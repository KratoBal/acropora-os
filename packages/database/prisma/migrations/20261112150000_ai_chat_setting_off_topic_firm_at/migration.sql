-- A TÉMÁN KÍVÜLI SOROZAT KÜSZÖBE (kártya f5b8f7ba; Balázs 2026-11-11 08:51: 5, a Beállításokban állítható): egy új oszlop
-- alapértékkel, a meglévő sor 5-öt kap, tehát a telepítés után semmit nem kell betölteni. A CHECK a szerver határát
-- (`AI_CHAT_SETTINGS_LIMITS.offTopicFirmAt`, 2 és 20) ismétli meg az adatbázisban.

-- AlterTable
ALTER TABLE "AiChatSetting" ADD COLUMN "offTopicFirmAt" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "AiChatSetting" ADD CONSTRAINT "AiChatSetting_offTopicFirmAt_range" CHECK ("offTopicFirmAt" BETWEEN 2 AND 20);
