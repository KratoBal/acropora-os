-- MUNKAÓRA A MUNKALAP-TÉTELEN: hányan dolgoztak rajta, és melyik tétel számít
-- egyáltalán munkának.
--
-- Balázs kérése, 2026-09-17, szó szerint: "ha rögzíti a szervizes a tételt akkor
-- meg tudja adni, hogy az adott tételen hányan dolgoztak és a végén legyen egy
-- össz munkaóra ami automatikusan számol tételenként és az összes tétel esetben
-- is. Tehát ha egy tétel 0.5 óra de ketten dolgoztak rajta akkor az 1 óra és ha
-- három ilyen tétel van akkor összesen 3 óra."
--
-- === MIÉRT KELL KÜLÖN JELÖLŐ, ÉS MIÉRT NEM A `unit` SZÖVEGE ===
--
-- A `unit` szabad szöveg (a séma saját kommentje: "soronként változik, ma
-- szabad szöveg", @MaxLength(20)). Ha az összesítés a szövegre épülne, egy
-- elgépelt "ora", egy nagy kezdőbetűs "Óra" vagy egy "munkaóra" CSENDBEN
-- kimaradna az összegből -- és a hibás összeg hihetőnek látszana.
--
-- A `unit` ezért VÁLTOZATLANUL szabad szöveg marad: aki ma "alkalom"-at vagy
-- "km"-t ír, azt ez a migráció nem veszi el tőle.
--
-- === A MA LÉTEZŐ SOROK, KIMONDVA ===
--
-- Az alábbi UPDATE EGYSZER néz szöveget, és ez MÁS, mint ha az összesítés
-- nézné: egy egyszeri lépés hatóköre kimondható és lemérhető, egy folyamatos
-- szöveg-egyezés minden új elgépelésnél újra csendben téved.
--
-- A hatóköre SZŰK és szándékosan az: `ora`, `óra`, `munkaora`, `munkaóra`,
-- kis- és nagybetűtől és a körülvevő szóköztől függetlenül. Minden más sor
-- `OTHER` marad.
--
-- AMI EBBŐL KÖVETKEZIK, ÉS NEM REJTJÜK EL: ha valaki ma más írásmóddal vitt fel
-- óra-tételt (például "h" vagy "munka óra"), az a sor `OTHER` marad, és NEM
-- számít bele az összesített munkaórába. Ez a felületen javítható -- a fajta
-- szerkeszthető mező --, és a javítás után az összeg magától helyes lesz.
-- A fordítottja (egy nem-munka tétel tévedésből LABOR-ra kerül) ezzel a szűk
-- listával nem tud előállni.
--
-- A `workerCount` alapértelmezése 1, tehát EGYETLEN MA LÉTEZŐ ÖSSZEG SEM
-- VÁLTOZIK meg attól, hogy ez a mező megjelenik: minden sor egy emberrel
-- számol, ahogy eddig is.

-- CreateEnum
CREATE TYPE "WorksheetLineKind" AS ENUM ('LABOR', 'OTHER');

-- AlterTable
ALTER TABLE "WorksheetLine"
    ADD COLUMN "kind" "WorksheetLineKind" NOT NULL DEFAULT 'OTHER',
    ADD COLUMN "workerCount" INTEGER NOT NULL DEFAULT 1;

-- A ma létező óra-tételek megjelölése. Lásd a fejlécben a hatókört.
UPDATE "WorksheetLine"
SET "kind" = 'LABOR'
WHERE lower(btrim("unit")) IN ('ora', 'óra', 'munkaora', 'munkaóra');
