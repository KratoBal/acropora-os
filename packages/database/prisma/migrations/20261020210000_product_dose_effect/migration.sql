-- ReefClub, slice 7 (task reefclub-szelet-7, plan v6.1 section 6.2): the product dose list in the
-- OS. Additive only: two new tables and two new enums; no existing table or column changes.
-- ROLLBACK: drop the tables ProductDoseEffectVersion and ProductDoseEffect (in this order), then
-- the types DoseUnit and DoseEffectDirection. Nothing reads them yet (the automatic
-- recommendation is slice 8).
-- CreateEnum
CREATE TYPE "DoseEffectDirection" AS ENUM ('EMEL', 'CSOKKENT');

-- CreateEnum
CREATE TYPE "DoseUnit" AS ENUM ('ML', 'G', 'CSEPP');

-- CreateTable
CREATE TABLE "ProductDoseEffect" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "parameterCode" TEXT NOT NULL,
    "direction" "DoseEffectDirection" NOT NULL,
    "effectPer100L" DECIMAL(19,6) NOT NULL,
    "doseUnit" "DoseUnit" NOT NULL,
    "doseStep" DECIMAL(19,6) NOT NULL,
    "maxDailyDosePer100L" DECIMAL(19,6),
    "effectHours" INTEGER,
    "source" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDoseEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductDoseEffectVersion" (
    "id" TEXT NOT NULL,
    "effectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectPer100L" DECIMAL(19,6) NOT NULL,
    "doseUnit" "DoseUnit" NOT NULL,
    "doseStep" DECIMAL(19,6) NOT NULL,
    "maxDailyDosePer100L" DECIMAL(19,6),
    "effectHours" INTEGER,
    "source" TEXT NOT NULL,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "ProductDoseEffectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductDoseEffect_productId_idx" ON "ProductDoseEffect"("productId");

-- CreateIndex
CREATE INDEX "ProductDoseEffect_parameterCode_direction_idx" ON "ProductDoseEffect"("parameterCode", "direction");

-- CreateIndex
CREATE INDEX "ProductDoseEffect_recordedById_idx" ON "ProductDoseEffect"("recordedById");

-- CreateIndex
CREATE INDEX "ProductDoseEffect_verifiedById_idx" ON "ProductDoseEffect"("verifiedById");

-- CreateIndex
CREATE INDEX "ProductDoseEffectVersion_recordedById_idx" ON "ProductDoseEffectVersion"("recordedById");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDoseEffectVersion_effectId_version_key" ON "ProductDoseEffectVersion"("effectId", "version");

-- AddForeignKey
ALTER TABLE "ProductDoseEffect" ADD CONSTRAINT "ProductDoseEffect_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDoseEffect" ADD CONSTRAINT "ProductDoseEffect_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDoseEffect" ADD CONSTRAINT "ProductDoseEffect_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDoseEffectVersion" ADD CONSTRAINT "ProductDoseEffectVersion_effectId_fkey" FOREIGN KEY ("effectId") REFERENCES "ProductDoseEffect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDoseEffectVersion" ADD CONSTRAINT "ProductDoseEffectVersion_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One live row per product, parameter and direction; an archived row stays as history.
CREATE UNIQUE INDEX "ProductDoseEffect_live_key" ON "ProductDoseEffect"("productId", "parameterCode", "direction") WHERE "archivedAt" IS NULL;

-- The numbers are positive, the source is not empty, and the colleague who checked a row is not
-- the one who recorded it (plan 6.2: two different colleagues). The service says the same; this
-- holds for any other writer too.
ALTER TABLE "ProductDoseEffect" ADD CONSTRAINT "ProductDoseEffect_values_check" CHECK (
  "effectPer100L" > 0
  AND "doseStep" > 0
  AND ("maxDailyDosePer100L" IS NULL OR "maxDailyDosePer100L" > 0)
  AND ("effectHours" IS NULL OR "effectHours" > 0)
  AND length(btrim("source")) > 0
  AND ("verifiedById" IS NULL OR "verifiedById" IS DISTINCT FROM "recordedById")
);
