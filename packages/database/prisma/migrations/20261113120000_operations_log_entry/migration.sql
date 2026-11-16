-- CreateTable
CREATE TABLE "OperationsLogEntry" (
    "id" TEXT NOT NULL,
    "clientOperationId" TEXT,
    "templateId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "templateName" VARCHAR(120) NOT NULL,
    "frequency" "OperationsTaskFrequency" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "anomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyNote" VARCHAR(2000),
    "internalNote" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationsLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationsLogEntryParticipant" (
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "OperationsLogEntryParticipant_pkey" PRIMARY KEY ("entryId","userId")
);

-- CreateTable
CREATE TABLE "OperationsLogEntryValue" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fieldKey" VARCHAR(40) NOT NULL,
    "fieldType" "OperationsTaskFieldType" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "unit" VARCHAR(16),
    "meterRole" "OperationsMeterRole",
    "numberValue" DECIMAL(19,6),
    "booleanValue" BOOLEAN,
    "textValue" VARCHAR(2000),

    CONSTRAINT "OperationsLogEntryValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationsLogEntry_clientOperationId_key" ON "OperationsLogEntry"("clientOperationId");

-- CreateIndex
CREATE INDEX "OperationsLogEntry_assetId_startedAt_idx" ON "OperationsLogEntry"("assetId", "startedAt");

-- CreateIndex
CREATE INDEX "OperationsLogEntry_templateId_startedAt_idx" ON "OperationsLogEntry"("templateId", "startedAt");

-- CreateIndex
CREATE INDEX "OperationsLogEntry_startedAt_idx" ON "OperationsLogEntry"("startedAt");

-- CreateIndex
CREATE INDEX "OperationsLogEntry_recordedById_idx" ON "OperationsLogEntry"("recordedById");

-- CreateIndex
CREATE INDEX "OperationsLogEntryParticipant_userId_idx" ON "OperationsLogEntryParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OperationsLogEntryValue_entryId_fieldKey_key" ON "OperationsLogEntryValue"("entryId", "fieldKey");

-- AddForeignKey
ALTER TABLE "OperationsLogEntry" ADD CONSTRAINT "OperationsLogEntry_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OperationsTaskTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntry" ADD CONSTRAINT "OperationsLogEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntry" ADD CONSTRAINT "OperationsLogEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntryParticipant" ADD CONSTRAINT "OperationsLogEntryParticipant_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationsLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntryParticipant" ADD CONSTRAINT "OperationsLogEntryParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationsLogEntryValue" ADD CONSTRAINT "OperationsLogEntryValue_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "OperationsLogEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written guards (Prisma cannot express CHECK constraints).
-- A finished entry cannot end before it started.
ALTER TABLE "OperationsLogEntry"
  ADD CONSTRAINT "OperationsLogEntry_finished_not_before_started"
  CHECK ("finishedAt" >= "startedAt");

-- An anomaly needs a note; no anomaly means no anomaly note.
ALTER TABLE "OperationsLogEntry"
  ADD CONSTRAINT "OperationsLogEntry_anomaly_note"
  CHECK (
    ("anomaly" = true AND "anomalyNote" IS NOT NULL AND btrim("anomalyNote") <> '')
    OR ("anomaly" = false AND "anomalyNote" IS NULL)
  );

-- Exactly the value column that matches the field type is filled. PHOTO values never land here (their images are separate rows).
ALTER TABLE "OperationsLogEntryValue"
  ADD CONSTRAINT "OperationsLogEntryValue_one_value_matches_type"
  CHECK (
    ("fieldType" = 'NUMBER'  AND "numberValue" IS NOT NULL AND "booleanValue" IS NULL AND "textValue" IS NULL)
    OR ("fieldType" = 'BOOLEAN' AND "booleanValue" IS NOT NULL AND "numberValue" IS NULL AND "textValue" IS NULL)
    OR ("fieldType" = 'TEXT'    AND "textValue" IS NOT NULL AND "numberValue" IS NULL AND "booleanValue" IS NULL)
  );

-- The unit and the meter role only make sense on numbers (same rule as the template fields).
ALTER TABLE "OperationsLogEntryValue"
  ADD CONSTRAINT "OperationsLogEntryValue_number_only_unit_role"
  CHECK ("fieldType" = 'NUMBER' OR ("unit" IS NULL AND "meterRole" IS NULL));
