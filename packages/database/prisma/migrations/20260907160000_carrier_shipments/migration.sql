-- CreateTable
CREATE TABLE "CarrierShipment" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "parcelNumber" TEXT,
    "status" TEXT NOT NULL,
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarrierShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarrierShipment_salesOrderId_createdAt_idx" ON "CarrierShipment"("salesOrderId", "createdAt");
CREATE INDEX "CarrierShipment_carrier_parcelNumber_idx" ON "CarrierShipment"("carrier", "parcelNumber");
CREATE INDEX "CarrierShipment_orderReference_idx" ON "CarrierShipment"("orderReference");

-- AddForeignKey
ALTER TABLE "CarrierShipment" ADD CONSTRAINT "CarrierShipment_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
