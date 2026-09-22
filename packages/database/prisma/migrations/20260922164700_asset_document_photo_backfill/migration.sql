-- A MÁR FELTÖLTÖTT KÉPEK ÁTSOROLÁSA `OTHER` FAJTÁRÓL `PHOTO`-RA.
--
-- Külön migráció, mert az előző tranzakcióban felvett enum-érték ott még nem
-- volt hivatkozható. Az indoklás az `..._asset_document_photo_type` fejlécén
-- áll.
--
-- A FELTÉTEL SZÁNDÉKOSAN SZŰK, ÉS EZ A SOR A LÉNYEG:
--
--     type = 'OTHER'  ÉS  contentType LIKE 'image/%'
--
-- 1. CSAK `OTHER`. A `WARRANTY`, a `MANUAL` és az `INVOICE` besorolt fajta: azt
--    egy ember mondta ki, és nem a mi dolgunk felülírni. Egy kép formátumú
--    garanciajegy attól még garanciajegy.
-- 2. CSAK `image/%`, KISBETŰSEN, pontosan ebben az írásmódban. A tágabb alak
--    (`lower(contentType)`) több sort venne be, és pont a VESZÉLYES irányba:
--    minden átsorolt sor a partner számára LÁTHATÓVÁ válik. A két tévedés ára
--    nem egyforma -- egy kimaradt kép HANGOS (a partner szól, hogy nem látja),
--    egy tévedésből kinyitott sor NÉMA. Ezért a szűkebb alak.
--
-- A DARABSZÁMOT EZ A MIGRÁCIÓ NEM ÁLLÍTJA, ÉS EZ SZÁNDÉKOS. A kártyán 43 szerepel,
-- de az egy KORÁBBI mérés egy MÁSIK pillanatból: azóta jöhetett új feltöltés, és
-- törlődhetett régi. A futásidejű szám a `RAISE NOTICE` sorban jelenik meg, tehát
-- a migrációs naplóból visszaolvasható, hogy VALÓJÁBAN hány sort érintett.
--
-- VISSZAÚT: van, és olcsó. A művelet egyetlen oszlopot ír, adatot nem semmisít
-- meg; visszafelé `UPDATE ... SET type = 'OTHER' WHERE type = 'PHOTO'`. AMI VELE
-- NEM ÁLL VISSZA: az azóta PHOTO fajtával FELTÖLTÖTT sorok is `OTHER`-be esnének,
-- és azok soha nem voltak azok. Vagyis a visszaút a migrációt követő első új
-- feltöltésig teljes, utána már nem -- ezt tudni kell, mielőtt valaki meghívja.

DO $$
DECLARE
  erintett integer;
BEGIN
  UPDATE "AssetDocument"
     SET "type" = 'PHOTO'
   WHERE "type" = 'OTHER'
     AND "contentType" LIKE 'image/%';

  GET DIAGNOSTICS erintett = ROW_COUNT;
  RAISE NOTICE 'AssetDocument OTHER -> PHOTO atsorolva: % sor', erintett;
END $$;
