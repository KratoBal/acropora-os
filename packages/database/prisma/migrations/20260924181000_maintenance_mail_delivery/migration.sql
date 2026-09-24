-- CreateTable
CREATE TABLE "MaintenanceMailDelivery" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "initiatedByUserId" TEXT,
    "subject" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "attachmentBytes" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceMailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceMailDelivery_serviceJobId_createdAt_idx" ON "MaintenanceMailDelivery"("serviceJobId", "createdAt");
