-- T5.3 (task t53-gyartoi-allitasok, card d546cfb5): the manufacturer claims of a product, with their
-- source and check state, and the append-only claim log. Additive only: two new tables and four new
-- enums; no existing table or column changes.
-- ROLLBACK: drop the tables ProductManufacturerClaimEvent and ProductManufacturerClaim (in this
-- order), then the types ManufacturerClaimEventKind, ManufacturerClaimStatus,
-- ManufacturerClaimSourceKind and ManufacturerClaimType. Nothing else reads them.
-- CreateEnum
CREATE TYPE "ManufacturerClaimType" AS ENUM ('DOSING', 'EFFECT', 'COMPOSITION', 'APPLICABILITY', 'SAFETY', 'ADVERTISING', 'OTHER');

-- CreateEnum
CREATE TYPE "ManufacturerClaimSourceKind" AS ENUM ('DATASHEET', 'MANUFACTURER_PAGE', 'LABEL', 'MANUFACTURER_GUIDE', 'AUTHOR_ARTICLE');

-- CreateEnum
CREATE TYPE "ManufacturerClaimStatus" AS ENUM ('UNVERIFIED', 'MATCHES_MANUFACTURER', 'INDEPENDENTLY_CONFIRMED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ManufacturerClaimEventKind" AS ENUM ('CREATED', 'EDITED', 'STATUS_CHANGED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "ProductManufacturerClaim" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "claimType" "ManufacturerClaimType" NOT NULL,
    "claimText" TEXT NOT NULL,
    "sourceKind" "ManufacturerClaimSourceKind" NOT NULL,
    "sourceRef" VARCHAR(1000) NOT NULL,
    "sourcePublishedOn" DATE,
    "sourceReadOn" DATE NOT NULL,
    "valueAmount" DECIMAL(19,6),
    "valueUnit" VARCHAR(32),
    "note" VARCHAR(1000),
    "recheckOn" DATE,
    "knowledgeFactId" TEXT,
    "knowledgeFactRevision" INTEGER,
    "status" "ManufacturerClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductManufacturerClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductManufacturerClaimEvent" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "kind" "ManufacturerClaimEventKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductManufacturerClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_productId_idx" ON "ProductManufacturerClaim"("productId");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_status_claimType_idx" ON "ProductManufacturerClaim"("status", "claimType");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_knowledgeFactId_idx" ON "ProductManufacturerClaim"("knowledgeFactId");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_recordedById_idx" ON "ProductManufacturerClaim"("recordedById");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_verifiedById_idx" ON "ProductManufacturerClaim"("verifiedById");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaim_archivedById_idx" ON "ProductManufacturerClaim"("archivedById");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaimEvent_claimId_createdAt_idx" ON "ProductManufacturerClaimEvent"("claimId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductManufacturerClaimEvent_actorId_idx" ON "ProductManufacturerClaimEvent"("actorId");

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_knowledgeFactId_fkey" FOREIGN KEY ("knowledgeFactId") REFERENCES "ProductKnowledgeFact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaimEvent" ADD CONSTRAINT "ProductManufacturerClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ProductManufacturerClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductManufacturerClaimEvent" ADD CONSTRAINT "ProductManufacturerClaimEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The claim and its source are not empty; an amount has its unit and the other way round; only a
-- dosing claim names a Product Knowledge fact, always with the revision it was read at, and then
-- has no number of its own (the number lives in the fact, in one place); a checked state has its
-- time, an unchecked one has none; and the one who checked the current version is not the one who
-- recorded it (spec point 6). The service says the same; this holds for any other writer too.
ALTER TABLE "ProductManufacturerClaim" ADD CONSTRAINT "ProductManufacturerClaim_values_check" CHECK (
  length(btrim("claimText")) > 0
  AND length(btrim("sourceRef")) > 0
  AND (("valueAmount" IS NULL) = ("valueUnit" IS NULL))
  AND ("valueAmount" IS NULL OR "valueAmount" > 0)
  AND ("valueUnit" IS NULL OR length(btrim("valueUnit")) > 0)
  AND (("knowledgeFactId" IS NULL) OR ("claimType" = 'DOSING' AND "knowledgeFactRevision" IS NOT NULL AND "valueAmount" IS NULL))
  AND (("status" = 'UNVERIFIED') = ("verifiedAt" IS NULL))
  AND ("verifiedById" IS NULL OR "verifiedById" IS DISTINCT FROM "recordedById")
  AND "version" > 0
);
