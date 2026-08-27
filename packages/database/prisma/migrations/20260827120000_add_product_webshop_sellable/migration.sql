-- Acropora-tulajdonu uzleti dontes: a termek a SAJAT webshopunkban
-- ertekesitheto-e.
--
-- MIERT UJ MEZO, es miert nem a meglevo ChannelListing.isPublished:
-- az a UNAS allapotanak TUKRE, kizarolag a UNAS szinkron irja, es a
-- CatalogChannel enumnak egyetlen erteke van (UNAS). Vagyis a meglevo mezo a
-- forras publikacios allapotat mondja meg, nem a mi dontesunket.
--
-- AZ ALAPERTELMEZES HAMIS, szandekosan: egy termek ne valjon ertekesithetove
-- attol, hogy letrejott. A meglevo sorok is hamis erteket kapnak, tehat a
-- migracio SENKIT nem tesz elerhetove a storefronton.
ALTER TABLE "Product"
  ADD COLUMN "webshopSellable" BOOLEAN NOT NULL DEFAULT false;

-- A projekcio celhalmazanak szurese ezen a harmason megy.
CREATE INDEX "Product_catalogAuthority_isActive_webshopSellable_idx"
  ON "Product" ("catalogAuthority", "isActive", "webshopSellable");
