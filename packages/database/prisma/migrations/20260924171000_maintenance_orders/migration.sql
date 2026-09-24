-- CreateEnum
CREATE TYPE "MaintenanceOrderStatus" AS ENUM ('ISSUED', 'SIGNED', 'REVOKED');

-- CreateEnum
CREATE TYPE "MaintenanceOrderDocumentType" AS ENUM ('GENERATED_FORM', 'SIGNED_FORM');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "organizationalUnitName" TEXT;

-- CreateTable
CREATE TABLE "MaintenanceOrder" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "MaintenanceOrderStatus" NOT NULL DEFAULT 'ISSUED',
    "occasionYear" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByName" TEXT,
    "signedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,
    "revokeReason" TEXT,
    "serviceJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOrderItem" (
    "id" TEXT NOT NULL,
    "maintenanceOrderId" TEXT NOT NULL,
    "contractItemId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "MaintenanceOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceOrderDocument" (
    "id" TEXT NOT NULL,
    "maintenanceOrderId" TEXT NOT NULL,
    "type" "MaintenanceOrderDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceOrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOrder_number_key" ON "MaintenanceOrder"("number");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOrder_serviceJobId_key" ON "MaintenanceOrder"("serviceJobId");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_contractId_idx" ON "MaintenanceOrder"("contractId");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_status_idx" ON "MaintenanceOrder"("status");

-- CreateIndex
CREATE INDEX "MaintenanceOrder_contractId_occasionYear_idx" ON "MaintenanceOrder"("contractId", "occasionYear");

-- CreateIndex
CREATE INDEX "MaintenanceOrderItem_contractItemId_idx" ON "MaintenanceOrderItem"("contractItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceOrderItem_maintenanceOrderId_contractItemId_key" ON "MaintenanceOrderItem"("maintenanceOrderId", "contractItemId");

-- CreateIndex
CREATE INDEX "MaintenanceOrderDocument_maintenanceOrderId_createdAt_idx" ON "MaintenanceOrderDocument"("maintenanceOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrder" ADD CONSTRAINT "MaintenanceOrder_serviceJobId_fkey" FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrderItem" ADD CONSTRAINT "MaintenanceOrderItem_maintenanceOrderId_fkey" FOREIGN KEY ("maintenanceOrderId") REFERENCES "MaintenanceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrderItem" ADD CONSTRAINT "MaintenanceOrderItem_contractItemId_fkey" FOREIGN KEY ("contractItemId") REFERENCES "ContractItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceOrderDocument" ADD CONSTRAINT "MaintenanceOrderDocument_maintenanceOrderId_fkey" FOREIGN KEY ("maintenanceOrderId") REFERENCES "MaintenanceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

