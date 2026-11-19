-- A fajta-mező egyezés megkötése ÚJ ÁGAT kap: WORKSHEET_LINKED és WORKSHEET_UNLINKED (kártya 5b366f5d).
--
-- A `ServiceJobEvent_kind_fields_agree` ZÁRT felsorolás (lásd 20260922150000): minden `kind`, amit egy migráció nem vett fel, a
-- megkötésen elbukik. A két új fajta enum-értéke a 20261119150000 migrációban jött létre; a megkötés ÚJ MIGRÁCIÓBAN bővül, és ez nem
-- stílus: a Postgres egy frissen hozzáadott enum-értéket ugyanabban a tranzakcióban nem használhat (55P04), a megkötés szövege pedig
-- használja. Ugyanaz a csapda, mint 2026-09-21-én (`NOTIFICATION_SENT`) és a `FIELDS_EDITED`-nél: az enum-bővítés egy sor, és semmi
-- nem kényszeríti ki a visszanézést egy MÁSIK migrációban álló felsorolásra. Ezt a CI első futása fogta meg (az integrációs spec
-- hozzákapcsolása a naplósoron bukott), helyben nem lehetett volna: nincs Postgres, a kalibráció dupla ellen ment.
--
-- A hivatkozás naplósora `toStatus IS NULL AND worksheetId IS NOT NULL`, mint a csatolásé: a jegy állapota nem változik tőle, és a
-- sor EGY munkalapról szól (a `worksheetId` `SET NULL` a munkalap törlésekor, a jegyzet őrzi a számát és tárgyát).
--
-- CSERE, NEM BŐVÍTÉS (az alkalmazott migrációt nem szerkesztjük): DROP + ADD. A meglévő sorokon nem bukhat el: az új feltétel a régi
-- három ágat betűre változatlanul tartalmazza, és csak egy újjal bővül (tágítás, nem szűkítés).
ALTER TABLE "ServiceJobEvent"
  DROP CONSTRAINT "ServiceJobEvent_kind_fields_agree";

ALTER TABLE "ServiceJobEvent"
  ADD CONSTRAINT "ServiceJobEvent_kind_fields_agree" CHECK (
    ("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL AND "worksheetId" IS NULL)
    OR ("kind" IN ('WORKSHEET_ATTACHED', 'WORKSHEET_DETACHED', 'WORKSHEET_LINKED', 'WORKSHEET_UNLINKED') AND "toStatus" IS NULL AND "worksheetId" IS NOT NULL)
    OR ("kind" IN ('FIELDS_EDITED', 'NOTIFICATION_SENT') AND "toStatus" IS NULL AND "worksheetId" IS NULL)
  );
