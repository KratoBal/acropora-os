-- AZ AI CSEVEGÉS KAPCSOLAT-KÉRÉSE (kártya f5b8f7ba, 4c szelet): egy új, üres tábla és egy új enum, meglévő sort nem érint, tehát
-- a telepítés után semmit nem kell betölteni. Amíg a beállításban a kapcsolat-kérés ki van kapcsolva (alapértelmezés), az AI
-- szolgáltatás nem ad át semmit, és a tábla üres marad. A teljes indoklás a sémában áll. A CHECK a szerver szabályát ismétli meg:
-- az elérhetőség nem üres és nem hosszabb 254 karakternél.

-- CreateEnum
CREATE TYPE "AiContactChannel" AS ENUM ('EMAIL', 'PHONE');

-- CreateTable
CREATE TABLE "AiContactRequest" (
    "id" TEXT NOT NULL,
    "channel" "AiContactChannel" NOT NULL,
    "value" TEXT NOT NULL,
    "conversationRef" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiContactRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiContactRequest_value_shape" CHECK (length(btrim("value")) > 0 AND length("value") <= 254)
);

-- CreateIndex
CREATE UNIQUE INDEX "AiContactRequest_requestKey_key" ON "AiContactRequest"("requestKey");

-- CreateIndex
CREATE INDEX "AiContactRequest_createdAt_idx" ON "AiContactRequest"("createdAt");
