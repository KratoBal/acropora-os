-- PRODUCT KNOWLEDGE, THE KZ AMINO VERTICAL SLICE (#1431, owner approval
-- 2026-10-03 16:33 UTC). Two tables: the accepted state of a field
-- (ProductKnowledgeFact) and the customer copy edited and approved in the OS
-- (ProductCopy). Nothing existing is altered.
--
-- WHY THE FACT -> FIELD RESULT KEY IS RESTRICT, NOT CASCADE:
-- a ProductEnrichmentFieldResult is deleted with its run (Cascade on the run,
-- then on the check). A fact holds only the accepted state; its sources and
-- any conflicting values live in that FieldResult and nowhere else. If the
-- run could still be deleted, an accepted fact would silently lose its
-- evidence and keep asserting a value nobody can trace. With RESTRICT, a run
-- whose results back an accepted fact cannot be deleted. Today only the
-- integration tests delete runs, so no production path changes.
--
-- The copy's "stale" flag is NOT a column: it is computed on read from
-- basedOn against the facts' current revisions, so it cannot drift.

-- CreateEnum
CREATE TYPE "ProductCopyBlock" AS ENUM ('lead', 'body', 'seoTitle', 'metaDescription');

-- CreateEnum
CREATE TYPE "ProductCopyStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "ProductKnowledgeFact" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "field" VARCHAR(48) NOT NULL,
    "value" TEXT,
    "unit" VARCHAR(16),
    "status" VARCHAR(32) NOT NULL,
    "fieldResultId" TEXT NOT NULL,
    "acceptedById" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductKnowledgeFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCopy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "block" "ProductCopyBlock" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ProductCopyStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL,
    "basedOn" JSONB NOT NULL,
    "editedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCopy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductKnowledgeFact_fieldResultId_idx" ON "ProductKnowledgeFact"("fieldResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductKnowledgeFact_productId_field_key" ON "ProductKnowledgeFact"("productId", "field");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCopy_productId_block_key" ON "ProductCopy"("productId", "block");

-- AddForeignKey
ALTER TABLE "ProductKnowledgeFact" ADD CONSTRAINT "ProductKnowledgeFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductKnowledgeFact" ADD CONSTRAINT "ProductKnowledgeFact_fieldResultId_fkey" FOREIGN KEY ("fieldResultId") REFERENCES "ProductEnrichmentFieldResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductKnowledgeFact" ADD CONSTRAINT "ProductKnowledgeFact_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCopy" ADD CONSTRAINT "ProductCopy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCopy" ADD CONSTRAINT "ProductCopy_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCopy" ADD CONSTRAINT "ProductCopy_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

