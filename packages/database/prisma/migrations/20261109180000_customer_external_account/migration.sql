-- ONE PARTNER REGISTER, 3.4: one Customer may carry several external (UNAS) accounts, in a table of its own.
-- The ExternalReference unique indexes STAY FULL: a partial (system, entityType, entityId) index breaks every
-- externalReference.upsert() (Postgres 42P10, measured on the #2180 verify-db). Additive: nothing reads or writes the table yet.

-- CreateTable
CREATE TABLE "CustomerExternalAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "system" "ExternalSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerExternalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerExternalAccount_customerId_idx" ON "CustomerExternalAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerExternalAccount_system_externalId_key" ON "CustomerExternalAccount"("system", "externalId");

-- AddForeignKey
ALTER TABLE "CustomerExternalAccount" ADD CONSTRAINT "CustomerExternalAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
