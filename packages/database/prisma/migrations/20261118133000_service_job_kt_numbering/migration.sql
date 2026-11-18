-- A KARBANTARTÁSI LAP SZÁMA KT-ÉÉÉÉ-NNN (t-20261118-kt-szam; Balázs, 2026-11-18, Luca-Balázs-Acrobot szál: "ha át tudod írni a számukat, akkor majd Luca eldönti"):
-- additív oszlop a régi számnak, majd EGY IDEMPOTENS ADATLÉPÉS: a HJ-számon felvett karbantartások (kind = MAINTENANCE) KT-számot kapnak, évenként,
-- a létrehozás sorrendjében; a régi szám a `previousNumber` mezőben marad, a felszabadított HJ-szám a `ServiceJobDeletion` táblába kerül (a HJ
-- sorozat nem használja újra). Visszaállítás: a `previousNumber` a régi szám.

-- AlterTable
ALTER TABLE "ServiceJob" ADD COLUMN     "previousNumber" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceJob_previousNumber_key" ON "ServiceJob"("previousNumber");

-- DATA STEP START
-- Idempotens: csak a még át nem számozott (previousNumber IS NULL), HJ-alakú MAINTENANCE sorokat érinti; ismételt futás nulla sort mozgat.
-- A KT-sorozat egy már meglévő KT-számnál folytatódik (az évenkénti legnagyobb után), a 999 feletti sorszám nem csonkul.
WITH numbered AS (
  SELECT
    j."id",
    j."jobNumber" AS old_number,
    substring(j."jobNumber" from '^HJ-([0-9]{4})-') AS yr,
    row_number() OVER (
      PARTITION BY substring(j."jobNumber" from '^HJ-([0-9]{4})-')
      ORDER BY j."createdAt", j."id"
    ) AS rn
  FROM "ServiceJob" j
  WHERE j."kind" = 'MAINTENANCE'
    AND j."previousNumber" IS NULL
    AND j."jobNumber" ~ '^HJ-[0-9]{4}-[0-9]+$'
), based AS (
  SELECT
    n."id",
    n.old_number,
    n.yr,
    n.rn + COALESCE((
      SELECT max(substring(k."jobNumber" from '[0-9]+$')::int)
      FROM "ServiceJob" k
      WHERE k."jobNumber" ~ ('^KT-' || n.yr || '-[0-9]+$')
    ), 0) AS serial
  FROM numbered n
), moved AS (
  UPDATE "ServiceJob" j
  SET
    "previousNumber" = b.old_number,
    "jobNumber" = 'KT-' || b.yr || '-' || CASE WHEN b.serial < 1000 THEN lpad(b.serial::text, 3, '0') ELSE b.serial::text END
  FROM based b
  WHERE j."id" = b."id"
  RETURNING b.old_number
)
INSERT INTO "ServiceJobDeletion" ("id", "jobNumber", "deletedAt", "deletedById")
SELECT 'kt-' || md5(m.old_number), m.old_number, CURRENT_TIMESTAMP, NULL
FROM moved m
ON CONFLICT ("jobNumber") DO NOTHING;
-- DATA STEP END
