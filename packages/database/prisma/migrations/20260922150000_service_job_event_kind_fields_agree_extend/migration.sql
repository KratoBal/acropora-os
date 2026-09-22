-- A fajta-mező egyezés megkötése KÉT ÚJ ÁGAT kap.
--
-- === A MEGKÖTÉS ZÁRT FELSOROLÁS, ÉS EZ A DOLGA ===
--
-- A `ServiceJobEvent_kind_fields_agree` (20260902170000) két ágat ismer:
-- `STATUS_CHANGE`, illetve a két munkalap-esemény. Minden más `kind` MINDKÉT
-- ágat elbukja, tehát a megkötés szerkezetileg visszautasít minden olyan
-- fajtát, amit egy későbbi migráció nem vett fel. ZÁRVA bukik, nem nyitva --
-- pontosan ezt várjuk egy őrzőtől.
--
-- === AMIT EZ KÉT HELYEN JELENT MA ===
--
-- 1. `FIELDS_EDITED` (ebben a PR-ban keletkezett): a CI első futása fogta meg,
--    kilenc egyforma bukással. Helyben nem lehetett volna elkapni: a
--    kalibráció duplával ment, és egy dupla nem ismeri az adatbázis-megkötést.
--
-- 2. `NOTIFICATION_SENT` (2026-09-02 óta létezik az enumban): a megkötés SOHA
--    nem kapott ágat hozzá, viszont a kód ÍR ilyen sort
--    (`apps/api/src/notifications/mail/ticket-mail.repository.ts:97`,
--    `recordNotification`), és nincs körülötte `try/catch`. Az a sor tehát ma
--    nem keletkezhet: a hívás a megkötésen dobna. Mérve 2026-09-22: egyetlen
--    migráció érinti a megkötést, és abban ez a fajta nem szerepel.
--
--    A JAVÍTÁS AZÉRT KERÜL IDE, ÉS NEM KÜLÖN PR-BA: ugyanaz a megkötés,
--    ugyanaz a felsorolás, egy sor. Egy migráció, ami „rendbe teszi" a
--    felsorolást és közben egy ismert lyukat benne hagy, rosszabb a semminél.
--
-- === MI ÁLL EGY ÚJ ÁGON, ÉS MIÉRT ===
--
-- Mindkét új fajtán `toStatus IS NULL AND worksheetId IS NULL`.
--
-- A `toStatus` azért `NULL`, mert EGYIKTŐL SEM változik a jegy állapota -- ezt
-- a `NOTIFICATION_SENT` esetében a kód saját jegyzete is kimondja („a jegy
-- állapota nem változik ettől az eseménytől, tehát a STATUS_CHANGE alá tenni
-- hazugság lenne"). A `worksheetId` azért `NULL`, mert egyik sem EGY LAPRÓL
-- szól: a mező-szerkesztés a jegy saját adatáról, az értesítés a kiküldés
-- tényéről.
--
-- A SZIGOR SZÁNDÉKOS, ugyanabból az okból, amit az eredeti migráció leír: a
-- diszkriminátor azért van, hogy egy sornak PONTOSAN EGY olvasata legyen. Egy
-- kitöltött `toStatus` egy `FIELDS_EDITED` soron két olvasatot adna.
--
-- === CSERE, NEM BŐVÍTÉS ===
--
-- Egy alkalmazott migráció fagyott, a kommentjével együtt, ezért a megkötés
-- DROP + ADD párban áll, ugyanúgy, mint a helyszín-kód számjegyeinél.
--
-- A MEGLÉVŐ SOROKON NEM BUKHAT EL: az új feltétel a régi két ágat betűre
-- változatlanul tartalmazza, és csak ÚJ ágakkal bővül. Ez tágítás, nem
-- szűkítés -- szűkítésnél itt előbb adatot kellene mérni.
ALTER TABLE "ServiceJobEvent"
  DROP CONSTRAINT "ServiceJobEvent_kind_fields_agree";

ALTER TABLE "ServiceJobEvent"
  ADD CONSTRAINT "ServiceJobEvent_kind_fields_agree" CHECK (
    ("kind" = 'STATUS_CHANGE' AND "toStatus" IS NOT NULL AND "worksheetId" IS NULL)
    OR ("kind" IN ('WORKSHEET_ATTACHED', 'WORKSHEET_DETACHED') AND "toStatus" IS NULL AND "worksheetId" IS NOT NULL)
    OR ("kind" IN ('FIELDS_EDITED', 'NOTIFICATION_SENT') AND "toStatus" IS NULL AND "worksheetId" IS NULL)
  );
