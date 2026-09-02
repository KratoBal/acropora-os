-- A munkalap mögé kerülhet hibajegy, és a lap átadható a szolgáltatónak.
--
-- MINDKÉT MEZŐ NULLABLE, ÉS EGYIK SEM KÉNYELEMBŐL:
--
-- A lap KELETKEZHET hibajegy nélkül: karbantartás közben derül ki, hogy valami
-- elromlott, a szerelő ott helyben felveszi a lapot, és a hibajegy nálunk
-- születik meg utólag. A kapcsolatot ezért UTÓLAG is fel kell tudni venni, egy
-- már meglévő lapra.
--
-- Az átadás pedig egy ESEMÉNY IDEJE, nem állapot: a lap addig nincs átadva,
-- amíg a szerelő nem végzett.
--
-- VISSZAFELÉ KOMPATIBILIS: minden meglévő sor NULL értéket kap, és a régi
-- viselkedés változatlan marad - a lezárás új feltétele külön lép életbe.
ALTER TABLE "Worksheet" ADD COLUMN "serviceJobId" TEXT;
ALTER TABLE "Worksheet" ADD COLUMN "handedOverAt" TIMESTAMP(3);
ALTER TABLE "Worksheet" ADD COLUMN "handedOverById" TEXT;

CREATE INDEX "Worksheet_serviceJobId_idx" ON "Worksheet"("serviceJobId");

-- `SET NULL` mindkettőnél: egy törölt hibajegy vagy egy törölt felhasználó nem
-- viheti magával a lapot. A munkalap önálló dokumentum.
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_serviceJobId_fkey"
  FOREIGN KEY ("serviceJobId") REFERENCES "ServiceJob"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_handedOverById_fkey"
  FOREIGN KEY ("handedOverById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
