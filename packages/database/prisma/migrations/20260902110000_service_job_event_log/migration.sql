-- Ami a hibajeggyel történt, időrendben.
--
-- A részletlap egy naplót mutat, legújabb felül, és abban három forrás
-- keveredik: a csatolt munkalapok, az érintett eszközök és az állapotváltások.
-- Az első kettőnek megvan a maga táblája; ez a harmadik.
--
-- MIÉRT TÁBLA, ÉS NEM EGY MEZŐ A JEGYEN: egy "utoljára változott" mező azt
-- mondja meg, mikor lépett a jegy LEGUTÓBB. A napló azt kérdezi, mi történt
-- VÉGIG - és egy mezőből az előzmény soha nem állítható vissza.
--
-- ÚJ TÁBLA, MEGLÉVŐ SORT NEM ÉRINT: a migráció visszafelé kompatibilis.
CREATE TABLE "ServiceJobEvent" (
    "id" TEXT NOT NULL,
    "serviceJobId" TEXT NOT NULL,
    -- `NULL` a jegy létrejöttekor: annak nincs előzménye. Egy kitalált
    -- NEW -> NEW sor azt állítaná, hogy volt egy lépés, ami nem történt meg.
    "fromStatus" "ServiceJobStatus",
    "toStatus" "ServiceJobStatus" NOT NULL,
    "note" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceJobEvent_pkey" PRIMARY KEY ("id")
);

-- A napló mindig egy jegyre, időrendben visszafelé olvasva.
CREATE INDEX "ServiceJobEvent_serviceJobId_createdAt_idx"
  ON "ServiceJobEvent"("serviceJobId", "createdAt");

-- `CASCADE` a jegyre: a napló a jegyé, nélküle nincs értelme.
ALTER TABLE "ServiceJobEvent" ADD CONSTRAINT "ServiceJobEvent_serviceJobId_fkey"
  FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- `SET NULL` az aktorra: egy törölt felhasználó NEM viheti magával a naplót.
-- Ami történt, megtörtént - a sor akkor is igaz, ha már nem tudjuk, ki tette.
ALTER TABLE "ServiceJobEvent" ADD CONSTRAINT "ServiceJobEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
