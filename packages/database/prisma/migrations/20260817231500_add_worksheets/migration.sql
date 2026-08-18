-- CreateEnum
CREATE TYPE "WorksheetVersionStatus" AS ENUM ('DRAFT', 'AWAITING_SIGNATURE', 'SIGNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorksheetSignatureDecision" AS ENUM ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "worksheetPartnerCode" VARCHAR(8);

-- CreateTable
CREATE TABLE "WorksheetDepartment" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "code" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetDepartment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorksheetDepartment_code_check" CHECK ("code" ~ '^[A-Z]{1,3}$')
);

-- CreateTable
CREATE TABLE "WorksheetNumberSequence" (
    "id" TEXT NOT NULL,
    "partnerCode" VARCHAR(8) NOT NULL,
    "departmentCode" VARCHAR(3) NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetNumberSequence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorksheetNumberSequence_lastValue_check" CHECK ("lastValue" >= 0)
);

-- CreateTable
CREATE TABLE "Worksheet" (
    "id" TEXT NOT NULL,
    "number" TEXT,
    "numberYear" INTEGER,
    "sequence" INTEGER,
    "customerId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worksheet_pkey" PRIMARY KEY ("id"),
    -- A szám három tárolt része együtt keletkezik a lezáráskor. A félig
    -- kiosztott szám (van szöveg, de nincs sorszám) nem állapot, hanem hiba:
    -- a hiánytalanság ellenőrzése épp a nyers sorszámon fut.
    CONSTRAINT "Worksheet_number_parts_check" CHECK (
        ("number" IS NULL AND "numberYear" IS NULL AND "sequence" IS NULL)
        OR ("number" IS NOT NULL AND "numberYear" IS NOT NULL AND "sequence" IS NOT NULL)
    ),
    CONSTRAINT "Worksheet_sequence_check" CHECK ("sequence" IS NULL OR "sequence" >= 1)
);

-- CreateTable
CREATE TABLE "WorksheetVersion" (
    "id" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorksheetVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "unitName" TEXT,
    "description" TEXT,
    "issueDate" DATE,
    "fulfillmentDate" DATE,
    "dueDate" DATE,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "netAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "changeReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "WorksheetVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorksheetVersion_version_check" CHECK ("version" >= 1),
    -- A "lezárt" nem a státusz értelmezése, hanem tény: a DRAFT-on kívül
    -- minden állapothoz tartozik lezárási időpont, és fordítva.
    CONSTRAINT "WorksheetVersion_closed_state_check" CHECK (
        ("status" = 'DRAFT' AND "closedAt" IS NULL)
        OR ("status" <> 'DRAFT' AND "closedAt" IS NOT NULL)
    ),
    -- Az indoklás a második verziótól kötelező, és nem elég szóközzel
    -- kitölteni. Adatbázis-szinten van, mert egy csak szolgáltatásban őrzött
    -- szabályt egy jövőbeli második író út megkerülne.
    CONSTRAINT "WorksheetVersion_change_reason_check" CHECK (
        "version" = 1
        OR ("changeReason" IS NOT NULL AND btrim("changeReason") <> '')
    )
);

-- CreateTable
CREATE TABLE "WorksheetLine" (
    "id" TEXT NOT NULL,
    "worksheetVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "detail" TEXT,
    "assetId" TEXT,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitNet" DECIMAL(19,4) NOT NULL,
    "vatRatePercent" DECIMAL(5,2) NOT NULL,
    "netAmount" DECIMAL(19,4) NOT NULL,
    "vatAmount" DECIMAL(19,4) NOT NULL,
    "grossAmount" DECIMAL(19,4) NOT NULL,

    CONSTRAINT "WorksheetLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorksheetLine_position_check" CHECK ("position" >= 1),
    CONSTRAINT "WorksheetLine_vat_rate_check" CHECK ("vatRatePercent" >= 0 AND "vatRatePercent" <= 100)
);

-- CreateTable
CREATE TABLE "WorksheetVersionSignature" (
    "id" TEXT NOT NULL,
    "worksheetVersionId" TEXT NOT NULL,
    "decision" "WorksheetSignatureDecision" NOT NULL,
    "signerName" TEXT NOT NULL,
    "signedByUserId" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "WorksheetVersionSignature_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorksheetVersionSignature_signer_name_check" CHECK (btrim("signerName") <> '')
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_worksheetPartnerCode_key" ON "Customer"("worksheetPartnerCode");
CREATE UNIQUE INDEX "WorksheetDepartment_customerId_code_key" ON "WorksheetDepartment"("customerId", "code");
CREATE INDEX "WorksheetDepartment_customerId_isActive_idx" ON "WorksheetDepartment"("customerId", "isActive");
CREATE UNIQUE INDEX "WorksheetNumberSequence_partnerCode_departmentCode_year_key" ON "WorksheetNumberSequence"("partnerCode", "departmentCode", "year");
CREATE UNIQUE INDEX "Worksheet_number_key" ON "Worksheet"("number");
CREATE INDEX "Worksheet_customerId_createdAt_idx" ON "Worksheet"("customerId", "createdAt");
CREATE INDEX "Worksheet_departmentId_idx" ON "Worksheet"("departmentId");
CREATE INDEX "Worksheet_numberYear_sequence_idx" ON "Worksheet"("numberYear", "sequence");
CREATE UNIQUE INDEX "WorksheetVersion_worksheetId_version_key" ON "WorksheetVersion"("worksheetId", "version");
CREATE INDEX "WorksheetVersion_status_closedAt_idx" ON "WorksheetVersion"("status", "closedAt");
CREATE UNIQUE INDEX "WorksheetLine_worksheetVersionId_position_key" ON "WorksheetLine"("worksheetVersionId", "position");
CREATE INDEX "WorksheetLine_assetId_idx" ON "WorksheetLine"("assetId");
CREATE UNIQUE INDEX "WorksheetVersionSignature_worksheetVersionId_key" ON "WorksheetVersionSignature"("worksheetVersionId");
CREATE INDEX "WorksheetVersionSignature_signedByUserId_signedAt_idx" ON "WorksheetVersionSignature"("signedByUserId", "signedAt");

-- AddForeignKey
ALTER TABLE "WorksheetDepartment" ADD CONSTRAINT "WorksheetDepartment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorksheetVersion" ADD CONSTRAINT "WorksheetVersion_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorksheetVersion" ADD CONSTRAINT "WorksheetVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorksheetVersion" ADD CONSTRAINT "WorksheetVersion_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorksheetLine" ADD CONSTRAINT "WorksheetLine_worksheetVersionId_fkey" FOREIGN KEY ("worksheetVersionId") REFERENCES "WorksheetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorksheetLine" ADD CONSTRAINT "WorksheetLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorksheetVersionSignature" ADD CONSTRAINT "WorksheetVersionSignature_worksheetVersionId_fkey" FOREIGN KEY ("worksheetVersionId") REFERENCES "WorksheetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorksheetVersionSignature" ADD CONSTRAINT "WorksheetVersionSignature_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A partner-kód (Customer.worksheetPartnerCode) alakját szándékosan nem
-- CHECK constraint őrzi, hanem a validált szolgáltatás-réteg: a mező a
-- meglévő vevőtörzsön él, ahol a migráció futásakor a NULL a normál
-- állapot, és egy jövőbeli import egy hibás értéken némán elhasalna a
-- vevő mentésénél is. A részleg-kód ezzel szemben ehhez a szelethez
-- született, ott a CHECK az első pillanattól teljesíthető.
