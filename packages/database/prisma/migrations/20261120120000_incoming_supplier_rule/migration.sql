-- Known-supplier rules for the invoice collection's stored PDFs (acrobot 57881/57884). The live measurement of the 144 pending PDFs
-- showed that the NAV-number route ties none of them (118 numbers are not in the NAV, foreign and online suppliers), so the
-- decision becomes supplier-level: one person accepts a supplier once, and its next PDF is accepted by the collection itself,
-- logged and undoable. A new table and one nullable column; no existing row changes.

-- AlterTable
ALTER TABLE "IncomingSupplierDocument" ADD COLUMN "acceptedByRuleId" TEXT;

-- CreateTable
CREATE TABLE "IncomingSupplierRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taxKey" TEXT,
    "nameKey" TEXT,
    "senderDomain" TEXT,
    "label" TEXT NOT NULL,
    "grossCeilings" JSONB NOT NULL DEFAULT '{}',
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "sourceDocumentId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMP(3),
    "disabledByUserId" TEXT,

    CONSTRAINT "IncomingSupplierRule_pkey" PRIMARY KEY ("id"),
    -- a TAX rule has a tax key and no name key, a NAME rule the other way round and always an external sender
    CONSTRAINT "IncomingSupplierRule_kind_shape" CHECK (
      ("kind" = 'TAX' AND "taxKey" IS NOT NULL AND "nameKey" IS NULL)
      OR ("kind" = 'NAME' AND "nameKey" IS NOT NULL AND "taxKey" IS NULL AND "senderDomain" IS NOT NULL)
    )
);

-- CreateIndex
CREATE INDEX "IncomingSupplierRule_disabledAt_idx" ON "IncomingSupplierRule"("disabledAt");

-- CreateIndex
CREATE INDEX "IncomingSupplierDocument_acceptedByRuleId_idx" ON "IncomingSupplierDocument"("acceptedByRuleId");

-- One ACTIVE rule per key and sender (the Prisma schema cannot express a partial unique index on nullable columns).
CREATE UNIQUE INDEX "IncomingSupplierRule_active_key"
  ON "IncomingSupplierRule" ("kind", COALESCE("taxKey", ''), COALESCE("nameKey", ''), COALESCE("senderDomain", ''))
  WHERE "disabledAt" IS NULL;
