-- A Medusa-rendelesatvetel futas-naploja.
--
-- Az indoklas a schema.prisma-ban all. Roviden: nem puszta vizjel, mert egy
-- szarmaztatott maximum ket dolgot elveszitene -- a ZARAT (az `activeKey`
-- egyedi, tehat ket peldany nem futhat egyszerre ugyanarra az ablakra) es a
-- FELBEMARADT KOR megkulonboztetheto voltat (a `status` mondja meg, hogy egy
-- kor vegigment-e).
--
-- Ez a migracio UJ tablat es UJ felsorolast hoz letre. Meglevo sort nem ir at,
-- meglevo tablat nem modosit, tehat visszafele semmit nem ront el: a rendszer a
-- tabla nelkul is ugyanugy mukodik, mint ma.

-- CreateEnum
CREATE TYPE "MedusaOrderSyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'APPLIED', 'FAILED');

-- CreateTable
CREATE TABLE "MedusaOrderSyncRun" (
    "id" TEXT NOT NULL,
    "activeKey" TEXT,
    "status" "MedusaOrderSyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ordersSeen" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedusaOrderSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- A ZAR: egyszerre legfeljebb egy kor viselhet aktiv kulcsot. A lezart korok
-- `activeKey` mezoje null, es a Postgres tobb NULL-t enged egyedi indexben,
-- tehat a naplo egyutt marad.
CREATE UNIQUE INDEX "MedusaOrderSyncRun_activeKey_key" ON "MedusaOrderSyncRun"("activeKey");

-- CreateIndex
CREATE INDEX "MedusaOrderSyncRun_status_createdAt_idx" ON "MedusaOrderSyncRun"("status", "createdAt");
