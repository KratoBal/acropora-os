-- CreateTable
CREATE TABLE "GlsCompensationLetter" (
    "id" TEXT NOT NULL,
    "compensationDate" DATE NOT NULL,
    "clientNumber" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'HUF',
    "cod" DECIMAL(19,4) NOT NULL,
    "compensated" DECIMAL(19,4) NOT NULL,
    "transferred" DECIMAL(19,4) NOT NULL,
    "debt" DECIMAL(19,4) NOT NULL,
    "remaining" DECIMAL(19,4) NOT NULL,
    "references" TEXT[],
    "fileName" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlsCompensationLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlsCompensationLetter_sha256_key" ON "GlsCompensationLetter"("sha256");

-- CreateIndex
CREATE INDEX "GlsCompensationLetter_compensationDate_idx" ON "GlsCompensationLetter"("compensationDate");

