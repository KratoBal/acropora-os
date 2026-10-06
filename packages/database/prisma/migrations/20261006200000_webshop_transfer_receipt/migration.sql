-- AZ ELŐRE UTALÁS BEÉRKEZÉSE (kártya bb3a6bd5; Balázs, 2026-10-06 16:42 UTC:
-- „Kell a banki parositas! Es szolnia kell ha megjott a penz”). Egy új tábla
-- (rendelésenként egy sor: a pénz megjött, honnan tudjuk) és egy új értesítési
-- szerep. Meglévő sort nem érint: a tábla üres, a szerep senkinél nincs
-- bejelölve. A teljes indoklás a sémában áll.

-- AlterEnum
--
-- Az `ALTER TYPE ... ADD VALUE` ugyanabban a tranzakcióban biztonságos, mert a
-- migráció az új értéket nem használja DML-ben (a repo eddigi enum-bővítéseinek
-- alakja, lásd 20260922204900_material_request).
ALTER TYPE "NotificationRole" ADD VALUE 'WEBSHOP_TRANSFER_RECEIVED';

-- CreateEnum
CREATE TYPE "WebshopTransferReceiptSource" AS ENUM ('BANK_PAIRING', 'MANUAL');

-- CreateTable
CREATE TABLE "WebshopTransferReceipt" (
    "orderId" VARCHAR(64) NOT NULL,
    "proformaId" TEXT NOT NULL,
    "source" "WebshopTransferReceiptSource" NOT NULL,
    "bankTransactionId" TEXT,
    "reference" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebshopTransferReceipt_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebshopTransferReceipt_bankTransactionId_key" ON "WebshopTransferReceipt"("bankTransactionId");

