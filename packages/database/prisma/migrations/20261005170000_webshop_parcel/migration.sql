-- CreateEnum
CREATE TYPE "WebshopParcelStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateTable
CREATE TABLE "WebshopParcel" (
    "id" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "parcelNumber" TEXT,
    "carrierParcelId" TEXT,
    "size" TEXT,
    "codHuf" INTEGER,
    "status" "WebshopParcelStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebshopParcel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebshopParcel_commerceOrderId_status_idx" ON "WebshopParcel"("commerceOrderId", "status");

-- CreateIndex
CREATE INDEX "WebshopParcel_carrier_parcelNumber_idx" ON "WebshopParcel"("carrier", "parcelNumber");

-- EGY RENDELESHEZ LEGFELJEBB EGY AKTIV CSOMAG (Foxpost prompt 16. pont: "Refresh,
-- dupla kattintas vagy retry se tudjon duplikalt shipmentet letrehozni"). A
-- Prisma sema RESZLEGES egyedi indexet nem tud kifejezni, ezert all itt nyers
-- SQL-kent (elozmeny: 20260827020000, 20260918180000). Az adatbazis az utolso
-- vedvonal: ket parhuzamos iras kozul a masodik itt bukik el, a szolgaltatas
-- ezt DUPLICATE hibava forditja.
CREATE UNIQUE INDEX "WebshopParcel_one_active_per_order_key"
  ON "WebshopParcel"("commerceOrderId")
  WHERE "status" = 'ACTIVE';
