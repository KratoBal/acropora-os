-- A kimeno levelek szerkesztheto sablonja, esemenyenkent egy sor,
-- plusz a naplo uj esemenytipusa a kikuldes tenyehez.
-- Az indoklas a schema.prisma-ban all: ez a fajl alkalmazas utan befagy.

-- AlterEnum
ALTER TYPE "ServiceJobEventKind" ADD VALUE 'NOTIFICATION_SENT';

-- CreateTable
CREATE TABLE "TicketMailTemplate" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketMailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketMailTemplate_updatedByUserId_idx" ON "TicketMailTemplate"("updatedByUserId");

-- AddForeignKey
ALTER TABLE "TicketMailTemplate" ADD CONSTRAINT "TicketMailTemplate_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

