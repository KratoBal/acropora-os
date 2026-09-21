-- EGY KIMENO LEVEL NYOMA, CSAK BELSOS.
--
-- acrobot kikotese (2026-09-21 23:11): ez az elso ut, ami a hazon KIVULRE kuld
-- dokumentumot, es egy kimeno kuldes, amirol nincs sorunk, utolag nem letezik.
--
-- MERVE ugyanakkor, hogy miert nem volt eddig hova irni: a semaban a
-- levelezeshez CSAK a `TicketMailTemplate` tartozott, kuldes-tabla nem volt, a
-- `Logger` sora pedig jegyenkent nem kereshato.
--
-- A TABLA URESEN SZULETIK, es NEM ir at semmit: uj tabla, uj index, nulla
-- erintett sor a meglevo adatokon. Visszafele is artalmatlan (DROP TABLE), de
-- a sorok akkor elvesznek -- egy kikuldott level nyoma viszont nem
-- helyreallithato, ezert a visszavonas NEM rutinmuvelet.
--
-- A `recipients` JSONB: nev es cim parok. EZ AZ, AMI A JEGY NAPLOJABA NEM
-- KERULHET, mert az atmegy a partner portalra (fb945858 merese).
-- CreateTable
CREATE TABLE "TicketMailDelivery" (
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

    CONSTRAINT "TicketMailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketMailDelivery_serviceJobId_createdAt_idx" ON "TicketMailDelivery"("serviceJobId", "createdAt");

