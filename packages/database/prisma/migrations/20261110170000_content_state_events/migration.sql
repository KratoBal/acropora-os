-- The content queue's state log (T5.1, card db640e6a): who moved an item from which state to which, when, and why.
-- Append-only by the API surface (no update or delete path); older items have no history before this migration, and the
-- UI says so instead of guessing the past.

-- CreateTable
CREATE TABLE "ContentStateEvent" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "fromState" "ContentState",
    "toState" "ContentState" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentStateEvent_contentId_createdAt_idx" ON "ContentStateEvent"("contentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentStateEvent" ADD CONSTRAINT "ContentStateEvent_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
