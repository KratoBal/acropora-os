-- AZ ÜZENETEK 3. FÁZISA: kitűzés (prompt 14. pont) és továbbítás (prompt 9. pont;
-- Balázs, 2026-10-05). Csak új tábla és két új, NULL-ozható oszlop: meglévő sort nem ír.
-- A tervben szereplő trigram index NEM került be: a keresés ékezet-független
-- (unaccent mindkét oldalon), azt egy sima "text" index nem gyorsítaná, és a keresés
-- úgyis egy beszélgetésen belül fut.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "forwardedFromMessageId" TEXT,
ADD COLUMN     "forwardedFromUserId" TEXT;

-- CreateTable
CREATE TABLE "PinnedMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "pinnedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinnedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PinnedMessage_conversationId_createdAt_idx" ON "PinnedMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PinnedMessage_conversationId_messageId_key" ON "PinnedMessage"("conversationId", "messageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_forwardedFromMessageId_fkey" FOREIGN KEY ("forwardedFromMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_forwardedFromUserId_fkey" FOREIGN KEY ("forwardedFromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinnedMessage" ADD CONSTRAINT "PinnedMessage_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

