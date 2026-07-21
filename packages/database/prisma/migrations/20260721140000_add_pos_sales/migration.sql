-- CreateEnum
CREATE TYPE "PosPaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SalesOrderLineSyncStatus" AS ENUM ('PENDING', 'OK', 'FAILED');

-- AlterTable
ALTER TABLE "SalesOrder"
    ADD COLUMN "warehouseId" TEXT,
    ADD COLUMN "soldById" TEXT,
    ADD COLUMN "paymentMethod" "PosPaymentMethod",
    ADD COLUMN "invoiceRequested" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesOrderLine"
    ADD COLUMN "syncStatus" "SalesOrderLineSyncStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "syncError" TEXT;

-- CreateIndex
CREATE INDEX "SalesOrder_channel_createdAt_idx" ON "SalesOrder"("channel", "createdAt");

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
