-- EGY KIMENO LEVEL NYOMA, CSAK BELSOS.
--
-- Ez az elso ut, ami a hazon KIVULRE kuld dokumentumot, es egy kimeno kuldes,
-- amirol nincs sorunk, utolag nem letezik.
--
-- MIERT KULON TABLA, ES NEM AZ AuditLog EGY UJ AKCIOJA: az AuditLog-os alak
-- azon allna, hogy a jegy reszletlapja CSAK a torles-akcio sorait olvassa
-- vissza -- vagyis a cimeket egy SZURO valasztana el a portaltol, es egy
-- szurot el lehet felejteni. Kulon tablanal nincs mit kiszurni: a portal soha
-- nem is olvassa. A vedelem SZERKEZETI, nem felteteles.
--
-- ES A JEGY NAPLOJA MAST MOND, MINT EZ A TABLA: a naplo-sor a TENYT es a
-- DARABSZAMOT, ez a tabla azt, hogy KINEK.
--
-- AZ INDOK NEM AZ, HOGY A PARTNER MA LATNA A NAPLO-SORT. MA NEM LATJA: merve
-- 2026-09-22-en a fo agon, a `detail` vegpont partnernek a
-- `partnerServiceJobDetail` vetiteset adja, ami a naplo-bejegyzest OT
-- nevesitett mezobol epiti ujra (id, isCreation, partnerStatusLabel,
-- actorName, createdAt), es a `note` nincs koztuk.
--
-- AZ INDOK EZ: ennek a mezonek a LATHATOSAGA EGY NAP ALATT KETSZER valtozott
-- (2026-09-21 10:5x es 12:07). A lathatosag tehat nem tulajdonsag, hanem
-- pillanat -- es egy cim, ami egyszer bekerul egy naplo szovegebe, minden
-- jovobeli feluletnel egyutt utazik.
--
-- A TABLA URESEN SZULETIK, es NEM ir at semmit: uj tabla, uj index, nulla
-- erintett sor a meglevo adatokon.
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

