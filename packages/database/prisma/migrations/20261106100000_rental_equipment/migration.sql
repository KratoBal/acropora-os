-- RENTAL EQUIPMENT MASTER (task eszkozberles, S1; Balazs, 2026-11-06). One new, empty table; no existing row is touched.
-- ROLLBACK: DROP TABLE "RentalEquipment";
-- CreateTable
CREATE TABLE "RentalEquipment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serialNumber" TEXT,
    "dailyFeeHuf" INTEGER NOT NULL,
    "depositHuf" INTEGER NOT NULL,
    "replacementValueHuf" INTEGER NOT NULL,
    "accessories" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalEquipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalEquipment_serialNumber_key" ON "RentalEquipment"("serialNumber");

-- CreateIndex
CREATE INDEX "RentalEquipment_isActive_name_idx" ON "RentalEquipment"("isActive", "name");

