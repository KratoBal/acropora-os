-- CreateEnum
CREATE TYPE "ContentState" AS ENUM ('IDEA', 'DRAFTING', 'AWAITING_REVIEW', 'AWAITING_REVISION', 'AWAITING_APPROVAL', 'READY_TO_SEND', 'SCHEDULED', 'SENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ContentChannel" AS ENUM ('FACEBOOK_POST', 'FACEBOOK_AD', 'ARTICLE', 'OTHER');

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "channel" "ContentChannel" NOT NULL,
    "state" "ContentState" NOT NULL DEFAULT 'IDEA',
    "imageRequired" BOOLEAN NOT NULL DEFAULT false,
    "imageAttachedAt" TIMESTAMP(3),
    "authorId" TEXT,
    "reviewerId" TEXT,
    "plannedFor" TIMESTAMP(3),
    "scheduleAnchoredAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "externalPostId" TEXT,
    "externalUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "discardReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentComment" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentItem_state_plannedFor_idx" ON "ContentItem"("state", "plannedFor");

-- CreateIndex
CREATE INDEX "ContentItem_channel_state_idx" ON "ContentItem"("channel", "state");

-- CreateIndex
CREATE INDEX "ContentComment_contentId_createdAt_idx" ON "ContentComment"("contentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentComment" ADD CONSTRAINT "ContentComment_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
