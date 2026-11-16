-- RENTALS (task eszkozberles, S2; Balazs, 2026-11-06). One new enum and one new empty table; existing rows untouched.
-- ROLLBACK: DROP TABLE "Rental"; DROP TYPE "RentalStatus";
-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('OPEN', 'RETURNED');

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "rentalNumber" TEXT NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'OPEN',
    "customerId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "plannedReturnAt" TIMESTAMP(3) NOT NULL,
    "dailyFeeHuf" INTEGER NOT NULL,
    "depositHuf" INTEGER NOT NULL,
    "replacementValueHuf" INTEGER NOT NULL,
    "accessories" TEXT,
    "expectedFeeHuf" INTEGER NOT NULL,
    "note" TEXT,
    "returnedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rental_rentalNumber_key" ON "Rental"("rentalNumber");

-- CreateIndex
CREATE INDEX "Rental_status_plannedReturnAt_idx" ON "Rental"("status", "plannedReturnAt");

-- CreateIndex
CREATE INDEX "Rental_customerId_idx" ON "Rental"("customerId");

-- CreateIndex
CREATE INDEX "Rental_equipmentId_idx" ON "Rental"("equipmentId");

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "RentalEquipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one OPEN rental per device (not expressible in the Prisma schema): the database refuses the second, even when two
-- desks record at the same moment.
CREATE UNIQUE INDEX "Rental_equipmentId_open_key" ON "Rental"("equipmentId") WHERE "status" = 'OPEN';
