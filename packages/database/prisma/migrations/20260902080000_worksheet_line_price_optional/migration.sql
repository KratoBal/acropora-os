-- Az ár és a belőle számolt összegek elhagyhatóvá válnak a munkalap-tételen.
--
-- A szerelő a helyszínen azt rögzíti, mit csinált és mennyit; az árat az iroda
-- adja meg. Ár nélküli tétellel a lap nem zárható le, tehát a hiány nem marad
-- észrevétlen -- de a sor létrejöhet nélküle.
--
-- VISSZAFELÉ KOMPATIBILIS: a NOT NULL feloldása a meglévő sorokat nem érinti,
-- és minden mai sornak van értéke. A visszaút (NOT NULL visszatétele) csak
-- addig díjtalan, amíg nem keletkezik ár nélküli sor.
ALTER TABLE "WorksheetLine" ALTER COLUMN "unitNet" DROP NOT NULL;
ALTER TABLE "WorksheetLine" ALTER COLUMN "vatRatePercent" DROP NOT NULL;
ALTER TABLE "WorksheetLine" ALTER COLUMN "netAmount" DROP NOT NULL;
ALTER TABLE "WorksheetLine" ALTER COLUMN "vatAmount" DROP NOT NULL;
ALTER TABLE "WorksheetLine" ALTER COLUMN "grossAmount" DROP NOT NULL;
