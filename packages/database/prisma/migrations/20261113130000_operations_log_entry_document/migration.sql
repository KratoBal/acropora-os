-- CreateTable
CREATE TABLE "OperationsLogEntryDocument" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fieldKey" VARCHAR(40) NOT NULL,
    "fieldLabel" VARCHAR(120) NOT NULL,
    "clientOperationId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA,
    "storageKey" TEXT,
    "thumbnail" BYTEA,
    "uploadedById" TEXT,
    "caption" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsLogEntryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationsLogEntryDocument_clientOperationId_key" ON "OperationsLogEntryDocument"("clientOperationId");

-- CreateIndex
CREATE INDEX "OperationsLogEntryDocument_entryId_createdAt_idx" ON "OperationsLogEntryDocument"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationsLogEntryDocument_sha256_idx" ON "OperationsLogEntryDocument"("sha256");

-- AddForeignKey
ALTER TABLE "OperationsLogEntryDocument" ADD CONSTRAINT "OperationsLogEntryDocument_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationsLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntryDocument" ADD CONSTRAINT "OperationsLogEntryDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

