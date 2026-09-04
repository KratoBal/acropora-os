-- MIERT NEM MENT KI EGY TERMEK KEPE: A TERMEK MELLE, NEM CSAK A KIMENETRE.
--
-- Ma az ok KIZAROLAG a vetites-futas kimenetere irodik ki. Ot kulonbozo ok
-- letezik, es negy csak onnan derul ki -- ha a futast nem mentette el senki,
-- utolag nem lehet megmondani, melyik fogott. 2026-09-04-en ez majdnem
-- felrevitt minket: huszonket termek kepe azert nem ment ki, mert rossz gepen
-- futtattunk, es ezt HAROM kulonbozo meresbol kellett osszerakni. Ha az ok a
-- termek mellett allt volna, egy lekerdezes lett volna.
--
-- === MIERT A TERMEKEN, ES MIERT NEM A KEP SORAN ===
--
-- A kezenfekvo hely a `ProductImage` lenne. MERVE, hogy az rossz: ket UNAS-iro
-- (`unas-product-sync.repository.ts`, `unas-apply.repository.ts`) `deleteMany` +
-- `createMany` parossal irja ujra ezeket a sorokat, tehat egy ott tarolt ok
-- minden import utan CSENDBEN eltunne. A `Product` sort ezzel szemben csak
-- mezo-szintu `updateMany` irja (`mirrorState`, `missingSince`).
--
-- A granularitas is a termeket kivanja: a kiado az ELSO bukott kepnel megall es
-- a termek EGESZ kep-listajat visszatartja, mert egy felig feltoltott lista a
-- cel oldalon TOROLNE a tobbi kepet. Egy termek tehat egy okkal all.
--
-- === MIERT ENUM, ES NEM SZABAD SZOVEG ===
--
-- Az ot ok kozott MAS a teendo: a mester hianya a masoloe, a serult mester a
-- taroloe, a fel nem ismert tartalom valoszinuleg nem is kep, az elhasalt
-- feltoltes a bolte vagy a halozate, a hianyzo kep-sor pedig nem is hiba. Egy
-- kozos "blokkolva" jelzo epp ezt a kulonbseget tuntetne el, egy szabad szoveges
-- mezo pedig ket iro ket irasmodjat engedne meg ugyanarra az okra.
--
-- A szoveges reszlet KULON oszlopban all (melyik kep URL-je, milyen hiba): az a
-- diagnozis, az enum a besorolas. A ketto nem helyettesiti egymast.
--
-- === ES MIERT VAN IDOBELYEG ===
--
-- Egy elavult ok rosszabb, mint a semmi: e nelkul nem lehet megmondani, hogy a
-- verdikt a mai futasbol valo-e vagy harom hete allt be. A sikeres kikuldes
-- mind a harom oszlopot NULLAZZA -- egy ottfelejtett ok ugyanugy hazudna, mint
-- egy elavult komment egy azota bezart lyukrol.
--
-- === A MEGLEVO SOROK NULL-ON MARADNAK, ES EZ SZANDEKOS ===
--
-- A `NULL` jelentese "meg nem mertuk", nem "rendben van". Egy feltoltes itt
-- talalgatas lenne: a mai allapotot csak egy vetites-futas tudja megmondani, es
-- a kovetkezo futas minden erintett terméknel be is irja. Egy kitalalt kezdo
-- ertek epp azt a kerdest valaszolna meg hamisan, amiert az oszlop keszul.

-- CreateEnum
CREATE TYPE "MedusaImageBlockReason" AS ENUM ('NO_IMAGE_ROW', 'MASTER_MISSING', 'MASTER_CORRUPT', 'NOT_AN_IMAGE', 'UPLOAD_FAILED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "medusaImageBlockReason" "MedusaImageBlockReason";
ALTER TABLE "Product" ADD COLUMN "medusaImageBlockDetails" TEXT;
ALTER TABLE "Product" ADD COLUMN "medusaImageBlockedAt" TIMESTAMP(3);
