-- A TICKET@ LEVELEK BEOLVASASANAK ADATAI (kartya ec7b947b, S2b). Csak ujabb, nullable vagy alapertekes oszlopok: meglevo sort
-- nem erint (a Capasuli levelek feladoja, hitelesitese es kihagyasi oka NULL marad, a kimaradt csatolmanyok szama 0).

-- AlterTable
ALTER TABLE "ServiceDraftMail" ADD COLUMN "fromAddress" TEXT,
ADD COLUMN "authVerdict" VARCHAR(40),
ADD COLUMN "skipReason" VARCHAR(40),
ADD COLUMN "droppedAttachments" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceTicketDraft" ADD COLUMN "senderUserId" TEXT;

-- CreateIndex
CREATE INDEX "ServiceDraftMail_source_fromAddress_createdAt_idx" ON "ServiceDraftMail"("source", "fromAddress", "createdAt");

-- CreateTable
CREATE TABLE "ServiceDraftMailFailure" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastCode" VARCHAR(60) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDraftMailFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDraftMailFailure_mailbox_messageId_key" ON "ServiceDraftMailFailure"("mailbox", "messageId");
