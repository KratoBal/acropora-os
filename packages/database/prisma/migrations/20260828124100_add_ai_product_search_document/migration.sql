-- A KERESESI DOKUMENTUM: INDEX, NEM A VALASZ MASOLATA.
--
-- A modellhez kerulo leiras NEM ebbol jon: az az elo uton tisztul, a valasz
-- osszeallitasakor. Ennek a tablanak egyetlen dolga a MEGTALALHATOSAG. Ebbol
-- kovetkezik, hogy egy elavult sor csak azt rontja el, hogy egy termek
-- kesobb kerul elo -- tartalmi hibat nem okoz. Ez az a tulajdonsag, ami miatt
-- a dokumentum-epites kesobb kivehető lesz a szinkron tranzakciojabol.
CREATE TABLE "AiProductSearchDocument" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,

    -- A SULYOZAS NEGY SAVJA, KULON OSZLOPBAN. Nem egy osszefuzott szoveg,
    -- mert akkor a suly nem allithato at ujraepites nelkul.
    "title" TEXT NOT NULL DEFAULT '',           -- A suly: a termek neve
    "skus" TEXT NOT NULL DEFAULT '',            -- A suly: a cikkszamok
    "facets" TEXT NOT NULL DEFAULT '',          -- B suly: marka es kategoriak
    "descriptionShort" TEXT NOT NULL DEFAULT '',-- B suly
    "descriptionLong" TEXT NOT NULL DEFAULT '', -- C suly
    "parameters" TEXT NOT NULL DEFAULT '',      -- D suly

    -- A TOROLT TERMEK SORA MEGMARAD, csak ez lesz hamis. A "ezt korabban
    -- arultuk, X ota nem" tudas nem dobhato el.
    "isSearchable" BOOLEAN NOT NULL DEFAULT true,

    -- MELYIK RECEPTTEL EPULT. Egy teljes ujraepites vegyes verzioju tablat
    -- hagy maga utan menet kozben, es a valasz KIMONDJA, hogy a kerdezo
    -- vegyes verziot latott. Ezert kell oszlopban allnia, nem a kodban.
    "documentVersion" INTEGER NOT NULL DEFAULT 1,

    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProductSearchDocument_pkey" PRIMARY KEY ("id")
);

-- A GENERALT OSZLOP. A konfiguracio NEVE itt epul be, ezert kellett az elozo
-- migracio. A sulyok a tervbol jonnek: A a nev es a cikkszam, B a rovid
-- leiras a markaval es a kategoriakkal, C a hosszu leiras, D a parameterek.
--
-- A ROVID LEIRAS AZERT B, ES AZ INDOK NEM A HOSSZA: 1178 termeknel a rovid
-- leiras az EGYETLEN szoveg, ami letezik -- a katalogus 62 szazaleka --, es a
-- tisztitott kereshetо karakterek 82 szazaleka onnan jon.
ALTER TABLE "AiProductSearchDocument"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('acropora_hu', "title"), 'A') ||
    setweight(to_tsvector('acropora_hu', "skus"), 'A') ||
    setweight(to_tsvector('acropora_hu', "facets"), 'B') ||
    setweight(to_tsvector('acropora_hu', "descriptionShort"), 'B') ||
    setweight(to_tsvector('acropora_hu', "descriptionLong"), 'C') ||
    setweight(to_tsvector('acropora_hu', "parameters"), 'D')
  ) STORED;

-- EGY MARADO ELTERES A PRISMA SEMAHOZ KEPEST, ES MERVE VAN, NEM SEJTVE.
--
-- A Prismanak nincs generalt-oszlop tipusa, tehat a semaban a mezo
-- Unsupported("tsvector") @default(dbgenerated()) alakban all -- a KIFEJEZEST
-- nem tudja tartani. A prisma migrate diff ezert EGY sort mindig kiir:
-- "Altered column searchVector (default changed from Some(DbGenerated(None))
-- to Some(DbGenerated(Some(...))))".
--
-- EZ NEM DRIFT, HANEM A PRISMA HATARA, es azert all itt, mert a kovetkezo
-- ember ezt latja majd. AMIRE FIGYELNI KELL: egy `prisma migrate dev` ebbol
-- migraciot javasolhat, ami a generalast LEVENNE az oszloprol. Azt a
-- javaslatot el kell dobni -- az oszlop generalt marad.
--
-- A tobbi elteres megszunt: a trigram index a semaban is deklaralva van, es a
-- neve a Prisma alapertelmezese (..._title_idx), hogy ne latszodjon
-- atnevezesnek.

-- EGY TERMEK EGY DOKUMENTUM.
CREATE UNIQUE INDEX "AiProductSearchDocument_productId_key"
  ON "AiProductSearchDocument" ("productId");

-- RESZLEGES GIN. A kereses MINDIG egyutt kerdezi a szovegegyezest es a
-- kereshetoseget; ha a szures az indexen kivul marad, a Postgres elobb
-- megtalalja a nem kereshető sorokat, aztan eldobja oket.
CREATE INDEX "AiProductSearchDocument_searchVector_idx"
  ON "AiProductSearchDocument" USING GIN ("searchVector")
  WHERE "isSearchable";

-- TRIGRAM CSAK A NEVRE. Az elgepeles-tures akkor er valamit, ha valaki NEVET
-- vagy CIKKSZAMOT ir be korulbelul pontosan; folyo szovegen a szotovezeses
-- full-text amugy is illeszt, az ekezetet az unaccent rendezi.
CREATE INDEX "AiProductSearchDocument_title_idx"
  ON "AiProductSearchDocument" USING GIN ("title" gin_trgm_ops);

-- AZ UJRAEPITES HALADASA EGY LEKERDEZESBOL LATSZIK.
CREATE INDEX "AiProductSearchDocument_documentVersion_idx"
  ON "AiProductSearchDocument" ("documentVersion");

ALTER TABLE "AiProductSearchDocument"
  ADD CONSTRAINT "AiProductSearchDocument_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
