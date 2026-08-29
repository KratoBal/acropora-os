-- Az ACROPORA-tulajdonu termek sajat, BRUTTO eladasi ara es annak penzneme.
-- Balazs dontese, 2026-08-29 19:31, Discord: "Vegyuk fel a brutto arat."
--
-- Mindket oszlop NULLAZHATO, mert a meglevo termekek tobbsegenek nincs sajat
-- ara: az UNAS-tulajdonuake a UnasProductSnapshot tukreben all, es ahhoz ez a
-- kor nem nyul.

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "sellingGrossPrice" DECIMAL(19,4),
ADD COLUMN     "sellingPriceCurrency" VARCHAR(3);

-- A FELALLAPOT TILTASA, ADATBAZIS SZINTEN.
--
-- Ket kulon nullazhato oszlop negy allapotot enged meg, es ebbol ketto NEMA
-- HIBA: egy osszeg penznem nelkul ertelmezhetetlen, egy penznem osszeg nelkul
-- pedig azt sugallja, hogy van ar, holott nincs. Egyik sem hibazik magatol, es
-- egyik sem latszik a szamon.
--
-- Azert adatbazis szinten, es nem csak a kodban: az ar tobb uton is bekerulhet
-- (import, javito szkript, kezi javitas), es egy alkalmazas-oldali ellenorzes
-- csak azt az utat orzi, amelyiken atmegy.
--
-- Prisma-sema nem tud CHECK feltetelt kifejezni, ezert all itt nyers SQL
-- alakban. Nem a sema megkerulese: ugyanabban a migracioban all, mint az
-- oszlopok, es a sema kommentje hivatkozik ra.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_selling_price_pair"
  CHECK (
    ("sellingGrossPrice" IS NULL AND "sellingPriceCurrency" IS NULL)
    OR
    ("sellingGrossPrice" IS NOT NULL AND "sellingPriceCurrency" IS NOT NULL)
  );

-- A NEGATIV AR NEM UZLETI DONTES, HANEM ADATHIBA.
--
-- A brief 8. pontja kimondja, hogy negativ arat nem kuldunk a Medusaba. Ez a
-- feltetel eggyel korabban all: nem a kuldest tiltja, hanem a TAROLAST. Igy a
-- vetitesnek nem kell olyan allapotot kezelnie, ami elo sem allhat.
--
-- A NULLA MEGENGEDETT a tarolasban, es ez szandekos: hogy egy nulla forintos
-- termek uzletileg mit jelent, az NYITOTT KERDES (a brief 8. pontja szerint is
-- dontest igenyel). Amig nincs dontes, a tarolast nem tiltjuk le, a vetites
-- viszont nem fogja csendben ingyenes termekke tenni.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_selling_price_not_negative"
  CHECK ("sellingGrossPrice" IS NULL OR "sellingGrossPrice" >= 0);
