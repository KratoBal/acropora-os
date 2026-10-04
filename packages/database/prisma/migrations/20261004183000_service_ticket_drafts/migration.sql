-- CreateEnum
CREATE TYPE "ServiceDraftStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "ServiceDraftMail" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3),
    "originalText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceDraftMail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceTicketDraft" (
    "id" TEXT NOT NULL,
    "mailId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "repeatKey" TEXT,
    "originalProblem" TEXT NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "proposedDepartmentId" TEXT,
    "status" "ServiceDraftStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "acceptedServiceJobId" TEXT,
    "repeatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceTicketDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDraftAttachment" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,

    CONSTRAINT "ServiceDraftAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDraftMail_source_mailbox_messageId_key" ON "ServiceDraftMail"("source", "mailbox", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTicketDraft_acceptedServiceJobId_key" ON "ServiceTicketDraft"("acceptedServiceJobId");

-- CreateIndex
CREATE INDEX "ServiceTicketDraft_status_reportDate_idx" ON "ServiceTicketDraft"("status", "reportDate");

-- CreateIndex
CREATE INDEX "ServiceTicketDraft_source_mailbox_repeatKey_reportDate_idx" ON "ServiceTicketDraft"("source", "mailbox", "repeatKey", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceTicketDraft_source_mailbox_reportDate_fingerprint_key" ON "ServiceTicketDraft"("source", "mailbox", "reportDate", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceDraftAttachment_draftId_sha256_key" ON "ServiceDraftAttachment"("draftId", "sha256");

-- AddForeignKey
ALTER TABLE "ServiceTicketDraft" ADD CONSTRAINT "ServiceTicketDraft_mailId_fkey" FOREIGN KEY ("mailId") REFERENCES "ServiceDraftMail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDraftAttachment" ADD CONSTRAINT "ServiceDraftAttachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ServiceTicketDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
