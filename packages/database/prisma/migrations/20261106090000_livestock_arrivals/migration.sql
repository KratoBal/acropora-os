-- A VEVOI OLDALI ELO ALLAT ERKEZES (kartya f4e4832b, V2.6 S2; acrobot, 2026-11-06). Egy uj, ures tabla es ket uj enum, meglevo
-- sort nem erint; a Product-ra csak egy opcionalis kulcs mutat (ON DELETE SET NULL).
-- ROLLBACK: DROP TABLE "LivestockArrival"; DROP TYPE "LivestockArrivalStatus"; DROP TYPE "LivestockKind";

-- CreateEnum
CREATE TYPE "LivestockKind" AS ENUM ('FISH', 'INVERTEBRATE', 'CORAL');

-- CreateEnum
CREATE TYPE "LivestockArrivalStatus" AS ENUM ('ORDERED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "LivestockArrival" (
    "id" TEXT NOT NULL,
    "kind" "LivestockKind" NOT NULL,
    "label" TEXT NOT NULL,
    "productId" TEXT,
    "expectedOn" DATE NOT NULL,
    "quantity" INTEGER,
    "status" "LivestockArrivalStatus" NOT NULL DEFAULT 'ORDERED',
    "preorderable" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivestockArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LivestockArrival_status_expectedOn_idx" ON "LivestockArrival"("status", "expectedOn");

-- CreateIndex
CREATE INDEX "LivestockArrival_productId_idx" ON "LivestockArrival"("productId");

-- AddForeignKey
ALTER TABLE "LivestockArrival" ADD CONSTRAINT "LivestockArrival_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
