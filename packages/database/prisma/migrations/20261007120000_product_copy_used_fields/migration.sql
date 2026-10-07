-- SEO P0 PR 1b: A COPY-BLOKK CSAK A FELHASZNALT TENYEITOL FUGG (Balazs dontese,
-- 2026-10-07; terv: exchange/seo/seo-p0-terv-2026-10-07.md, "PR 1b").
--
-- Eddig a `basedOn` a termek OSSZES tenyenek reviziojat tartotta, tehat egyetlen
-- nem ellenorzott teny (pl. egy utkozo `dosing`) minden blokkot visszatartott.
-- Az uj oszlop blokkonkent sorolja fel a felhasznalt tenyeket; az elavulas es a
-- publikalhatosag csak ezeken mer.
--
-- NINCS VISSZATOLTES: a mai sorok ures listat kapnak, es ures listanal a regi,
-- termekszintu szabaly el tovabb. Egy blokk a kovetkezo menteskor kap valodi
-- listat. A szovegbol kitalalni, mire epul, kitalalas lenne.
--
-- Visszaallitas: az oszlop maradhat; a kod visszaallitasa utan a termekszintu
-- szabaly el (a regi kod nem olvassa).

-- AlterTable
ALTER TABLE "ProductCopy" ADD COLUMN     "usedFields" TEXT[] DEFAULT ARRAY[]::TEXT[];
