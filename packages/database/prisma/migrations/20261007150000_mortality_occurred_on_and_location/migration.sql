-- Elhullási napló, 2026-10-07 (Luca kérése): az elhullás NAPJA külön mező, és
-- megadható a halas rack, ahol történt. A halas rack nem akvárium, ezért egy
-- bejegyzéshez az akvárium VAGY a rack kell, legalább az egyik.
--
-- Meglévő sorba egyetlen mezőt ír: az új `occurredOn` oszlopot tölti fel a
-- létrehozás napjával. Más oszlop és más tábla meglévő sora nem változik.

-- A halas rackek: saját, kicsi törzsadat. Nem akvárium, és nem kerül az
-- Akváriumok menübe (Luca kérése); a kivezetés `archivedAt`-tal megy, mert
-- bejegyzés mutathat rá.
CREATE TABLE "MortalityLocation" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MortalityLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MortalityLocation_name_key" ON "MortalityLocation"("name");
CREATE INDEX "MortalityLocation_archivedAt_sortOrder_idx" ON "MortalityLocation"("archivedAt", "sortOrder");

-- A tíz kezdő név, Luca listája szerint, ebben a sorrendben. A hat oszlop neve
-- egységes írásmóddal áll („JOBB n. oszlop”); ő vegyesen írta (JOBB 1., JOBB 2,
-- jobb 3). `gen_random_uuid()` a PostgreSQL 13 óta a core része.
INSERT INTO "MortalityLocation" ("id", "name", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'JOBB 1. oszlop',                 10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JOBB 2. oszlop',                 20, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JOBB 3. oszlop',                 30, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JOBB 4. oszlop',                 40, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JOBB 5. oszlop',                 50, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'JOBB 6. oszlop',                 60, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Jobb hátsó nagy halas',          70, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Bal hátsó nagy halas (dühöngő)', 80, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Rákos 1',                        90, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'Rákos 2',                       100, CURRENT_TIMESTAMP);

-- Az elhullás napja. Előbb üresen, utána a meglévő sorok a létrehozásuk
-- BUDAPESTI napját kapják (a `createdAt` UTC-ben áll: egy éjfél utáni
-- rögzítés UTC szerint még az előző napra esne), végül kötelező lesz.
-- Adatbázis-alapérték szándékosan nincs: a `CURRENT_DATE` a szerver zónáját
-- olvasná, a „ma” viszont Budapest napja, és azt az alkalmazás adja meg.
ALTER TABLE "MortalityRecord" ADD COLUMN "occurredOn" DATE;
UPDATE "MortalityRecord"
  SET "occurredOn" = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Budapest')::date;
ALTER TABLE "MortalityRecord" ALTER COLUMN "occurredOn" SET NOT NULL;
CREATE INDEX "MortalityRecord_occurredOn_idx" ON "MortalityRecord"("occurredOn");

-- A halas rack, opcionálisan.
ALTER TABLE "MortalityRecord" ADD COLUMN "locationId" TEXT;
CREATE INDEX "MortalityRecord_locationId_idx" ON "MortalityRecord"("locationId");
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "MortalityLocation"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Akvárium VAGY halas rack, legalább az egyik. Az akvárium eddig kötelező volt,
-- tehát minden meglévő sornak van akváriuma, és a megkötés egyiken sem bukik.
ALTER TABLE "MortalityRecord" ALTER COLUMN "aquariumId" DROP NOT NULL;
ALTER TABLE "MortalityRecord" ADD CONSTRAINT "MortalityRecord_place_check" CHECK (
  num_nonnulls("aquariumId", "locationId") >= 1
);
