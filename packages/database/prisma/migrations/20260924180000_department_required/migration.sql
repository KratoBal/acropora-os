-- A HELYSZÍN KÖTELEZŐVÉ TÉTELE AZ ESZKÖZÖN ÉS A HIBAJEGYEN.
--
-- BALÁZS DÖNTÉSE, 2026-09-22 18:06:27 UTC (Discord, Acropora OS szál,
-- message_id 1552018256280162385), szó szerint: "1 legyen kotelezo".
-- A kérdés az volt, hogy kötelező legyen-e a helyszín az eszközön és a
-- hibajegyen; a válasz mind a kettőre igen. A munkalapon MÁR kötelező
-- (`Worksheet.departmentId` `String` a séma kezdete óta), ott nincs teendő.
--
-- === ELŐBB ELLENŐRZÜNK, ÉS CSAK UTÁNA SZIGORÍTUNK ===
--
-- acrobot 2026-09-22 15:2x-kor az ÉLES adatbázison mért: `Asset` 0/108 és
-- `ServiceJob` 0/6 sor áll helyszín nélkül, tehát a szigorítás ADATJAVÍTÁST
-- nem igényel. A szám mégsem kerül ide feltételként: a mérés és a futás között
-- telhet idő, és egy migrációba írt darabszám ugyanúgy fagy, mint egy komment.
--
-- Ehelyett a migráció MEGKÉRDEZI a saját futásakor. Ha talál NULL sort,
-- ELHASAL egy megnevezett hibával, MIELŐTT bármit átírna. Az indok nem
-- óvatoskodás: egy `SET NOT NULL` NULL sorok mellett amúgy is hibára futna, de
-- a Postgres üzenete csak az oszlopot nevezné meg -- nem azt, hogy HÁNY sorról
-- van szó és melyik táblában. A saját hibaüzenet ezt megmondja, és a
-- teendőt is: előbb az adatot kell rendezni.
--
-- === A VISSZAÚT ===
--
-- Van, és olcsó: `ALTER TABLE ... ALTER COLUMN "departmentId" DROP NOT NULL`.
-- A művelet adatot NEM semmisít meg, csak a megkötést állítja. AMI VELE NEM
-- ÁLL VISSZA: a szigorítás után keletkezett sorok mind viselnek helyszínt, és
-- azok az értékek megmaradnak -- ez nem kár, csak nem lesz belőlük újra NULL.

DO $$
DECLARE
  eszkoz integer;
  jegy   integer;
BEGIN
  SELECT count(*) INTO eszkoz FROM "Asset" WHERE "departmentId" IS NULL;
  SELECT count(*) INTO jegy   FROM "ServiceJob" WHERE "departmentId" IS NULL;

  IF eszkoz > 0 OR jegy > 0 THEN
    RAISE EXCEPTION
      'A helyszin nem teheto kotelezove: % eszkoz es % hibajegy all helyszin nelkul. Eloszor ezeket a sorokat kell rendezni.',
      eszkoz, jegy;
  END IF;

  RAISE NOTICE 'Helyszin nelkuli sor: 0 eszkoz, 0 hibajegy -- a szigoritas indulhat.';
END $$;

ALTER TABLE "Asset" ALTER COLUMN "departmentId" SET NOT NULL;
ALTER TABLE "ServiceJob" ALTER COLUMN "departmentId" SET NOT NULL;
