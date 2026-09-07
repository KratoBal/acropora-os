-- A TERMEK SZALLITASI JELLEMZOI: KEZZEL GONDOZOTT TORZSADAT, SAJAT TABLABAN.
--
-- === MIERT KULON TABLA, ES NEM MEZOK A `Product`-ON ===
--
-- A `Product` UZEMI rekord: a UNAS-szinkron irja, es a frissito ag mezonkent
-- donti el, mihez nyul hozza. Ha ezek a jelzok is ott ulnenek, a vedelmuk egy
-- LISTA lenne: a frissito ag felsorolasa arrol, mihez nem nyul. Az a fajta
-- vedelem ket okbol gyenge -- egy uj mezot barki felvehet ugy, hogy a listat
-- elfelejti boviteni, es a mulasztas NEMA: semmi nem all meg, csak egy gondozott
-- ertek eltunik egy szinkron-futas utan, es senki nem keresi.
--
-- Kulon tablaban a tulajdonjog nem szabaly, hanem ALAK: a szinkronnak nincs mit
-- irnia rajta. (acrobot dontese, 2026-09-07; precedens a `ProductDatasheet`.)
--
-- === MIERT NEM `ProductMaster` A TABLA NEVE ===
--
-- Mert az a nev a repoban MAR FOGLALT, es MAST jelent: a
-- `Product.catalogAuthority` az "aktualis Product Master", vagyis hogy KI a
-- termek gazdaja (UNAS vagy ACROPORA). Aki a docs/PRODUCT-CATALOG.md-t olvasta,
-- egy `ProductMaster` nevu tabla lattan NEM nezne utana -- a gazda-fogalomra
-- gondolna. Egy ismeros szo rossz jelentessel nem kerdest szul, hanem teves
-- magabiztossagot. A ket jelentes szetvalasztasa a dokumentumban all.
--
-- === MIERT NINCS DEFAULT ERTEK EGYIK JELZON SEM ===
--
-- Mind a negy EMBERI ITELET, es a hianyzo ertek nem "nem", hanem "meg senki nem
-- nezte meg". A megkulonboztetest a SOR letezese hordozza: nincs sor = nem
-- vizsgaltuk, van sor = valaki mind a negyrol dontott. Egy `DEFAULT false` epp
-- ezt tuntetne el, mert egy reszleges irasnal a ki nem toltott jelzok csendben
-- "nem"-re allnanak -- es egy nem vizsgalt termek ugyanugy nezne ki, mint egy
-- megvizsgalt, amelyikre semmi nem all.
--
-- === AMI SZANDEKOSAN NINCS ITT ===
--
-- SULY: a Commerce oldali modell kommentje kimondja, hogy az `is_heavy` kezzel
-- jelolt, SOSEM a sulybol szamolt; Balazs dontese szerint pedig termek-tomeget
-- nem viszunk fel. Nincs mit duplikalni.
--
-- LIVESTOCK: a Commerce oldalon sem ennek a modellnek a mezoje, hanem a
-- `ProductType.id`-bol dol el, kornyezeti valtozobol (alapertelmezetten uresen).
-- Nem adat, hanem konfiguracio, es masik rendszerben el.
--
-- A SZALLITASI OSZTALY SZAMITASA: a Commerce-ben azert el kodban es nem
-- szabalyban, mert a Medusa szabaly-motorja a "a kosar BARMELYIK tetele" logikat
-- nem tudja kifejezni (egy tombbe feloldodo attributumot vesszovel osszefuz).
-- Ez az indok NALUNK NEM ALL FENN, tehat a szamitas atmasolasa nem automatikus.
-- Ez a tabla az ADATOT hordozza, nem a dontest.
--
-- === MIERT NEM TOROD KOZTES ALLAPOT ===
--
-- Uj tabla, amit ma semmi nem olvas es semmi nem ir. A migracio onmagaban nem
-- valtoztat meg egyetlen meglevo viselkedest sem; az iro es olvaso ut kulon
-- korben jon, es akkor mar lesz mihez tesztet irni.

-- CreateTable
CREATE TABLE "ProductShippingProfile" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pickupOnly" BOOLEAN NOT NULL,
    "foxpostForbidden" BOOLEAN NOT NULL,
    "isHeavy" BOOLEAN NOT NULL,
    "isFrozen" BOOLEAN NOT NULL,

    CONSTRAINT "ProductShippingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductShippingProfile_productId_key" ON "ProductShippingProfile"("productId");

-- AddForeignKey
ALTER TABLE "ProductShippingProfile" ADD CONSTRAINT "ProductShippingProfile_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
