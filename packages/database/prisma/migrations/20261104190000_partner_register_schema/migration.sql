-- ONE PARTNER REGISTER, STEP 2 (plan: exchange/otletek-2026-11-04/egy-partnertorzs-terv-2026-11-04.md, 2.2 and 4.2; the owner
-- said yes to the plan on 2026-11-04 14:57 UTC). ADDITIVE ONLY: two generated key columns, a merge pointer, two new tables.
-- NOTHING READS OR WRITES THEM YET, and no existing column, row or constraint is changed.
--
-- ROLLBACK (every step is droppable, none carries data of its own until step 4, the merge):
--   DROP TABLE "CustomerAlias"; DROP TABLE "CustomerMergeLog"; DROP TYPE "CustomerAliasKind";
--   ALTER TABLE "Customer" DROP COLUMN "mergedIntoId", DROP COLUMN "huTaxBase", DROP COLUMN "euTaxKey";
-- (the indexes and foreign keys go with the columns and tables).

-- CreateEnum
CREATE TYPE "CustomerAliasKind" AS ENUM ('CUSTOMER_NUMBER', 'ROW_ID');

-- TWO SEPARATE KEYS, NOT ONE SHARED COLUMN: a `DE123456789` and a Hungarian number that starts with the same eight digits must
-- never fall into one group. Both are GENERATED ALWAYS ... STORED, so no writer has to remember to maintain them, and the
-- database refuses a write to them.
--
-- THE RULE IS THE READ-ONLY MEASUREMENT'S (`huBase` and `euKey` in apps/api/src/partner-duplicates/partner-duplicate-groups.ts),
-- written for PostgreSQL. `partner-register-sql-rule.spec.ts` compares the two over a table of values; the integration spec
-- compares the generated columns themselves with the TypeScript functions on a real database. Digits are [0-9], not \d:
-- the JavaScript \d is ASCII only, and the PostgreSQL one follows the locale.
--
-- huTaxBase: the first eight digits of a Hungarian tax number, ONLY from a value of Hungarian tax number shape (eight digits,
-- an optional HU prefix, an optional -x-yy tail, spaces around), otherwise NULL. A value starting with 4 is still a base (group
-- VAT identifiers look like that): telling it apart is the measurement's and the matching's job, not the column's.
-- euTaxKey: the community tax number with its country code, upper case, letters and digits only, otherwise NULL.
ALTER TABLE "Customer"
  ADD COLUMN "huTaxBase" TEXT GENERATED ALWAYS AS (
    CASE
      WHEN "taxNumber" ~* '^[[:space:]]*(HU)?[[:space:]]*[0-9]{8}(-?[0-9]-?[0-9]{2})?[[:space:]]*$'
      THEN substring("taxNumber" from '[0-9]{8}')
    END
  ) STORED,
  ADD COLUMN "euTaxKey" TEXT GENERATED ALWAYS AS (
    CASE
      WHEN upper(regexp_replace("euTaxNumber", '[^A-Za-z0-9]', '', 'g')) ~ '^[A-Z]{2}[0-9A-Z]{2,}$'
      THEN upper(regexp_replace("euTaxNumber", '[^A-Za-z0-9]', '', 'g'))
    END
  ) STORED,
  ADD COLUMN "mergedIntoId" TEXT;

-- CreateTable
CREATE TABLE "CustomerAlias" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "kind" "CustomerAliasKind" NOT NULL,
    "mergeLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerMergeLog" (
    "id" TEXT NOT NULL,
    "keptId" TEXT NOT NULL,
    "mergedId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "reason" TEXT,
    "movedRefs" JSONB NOT NULL,
    "fieldChanges" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "CustomerMergeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAlias_value_key" ON "CustomerAlias"("value");

-- CreateIndex
CREATE INDEX "CustomerAlias_customerId_idx" ON "CustomerAlias"("customerId");

-- CreateIndex
CREATE INDEX "CustomerAlias_mergeLogId_idx" ON "CustomerAlias"("mergeLogId");

-- CreateIndex
CREATE INDEX "CustomerMergeLog_keptId_idx" ON "CustomerMergeLog"("keptId");

-- CreateIndex
CREATE INDEX "CustomerMergeLog_mergedId_idx" ON "CustomerMergeLog"("mergedId");

-- CreateIndex
CREATE INDEX "Customer_mergedIntoId_idx" ON "Customer"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Customer_huTaxBase_idx" ON "Customer"("huTaxBase");

-- CreateIndex
CREATE INDEX "Customer_euTaxKey_idx" ON "Customer"("euTaxKey");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAlias" ADD CONSTRAINT "CustomerAlias_mergeLogId_fkey" FOREIGN KEY ("mergeLogId") REFERENCES "CustomerMergeLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMergeLog" ADD CONSTRAINT "CustomerMergeLog_keptId_fkey" FOREIGN KEY ("keptId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerMergeLog" ADD CONSTRAINT "CustomerMergeLog_mergedId_fkey" FOREIGN KEY ("mergedId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
