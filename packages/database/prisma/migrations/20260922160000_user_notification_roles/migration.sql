-- Értesítési szerepek a saját felhasználóinkon.
--
-- Balázs kérése, 2026-09-22: „a sajat felhasznaloinkhoz kell egy checkbox
-- ezzel a szereppel" (hibajegy-felelős). A szerep GLOBÁLIS: akinél be van
-- jelölve, az MINDEN ügyfél által nyitott jegyről értesül -- nem per-jegy
-- felelős.
--
-- === MIÉRT KÉSZLET, ÉS NEM KÉT LOGIKAI OSZLOP ===
--
-- Ez ugyanazon a napon a MÁSODIK értesítési jelölőnégyzet-kérés, és Balázs maga
-- mondta, hogy több pont jön. A következő pontok ÚJ ELEMKÉNT kerülnek az
-- enumba, nem új OSZLOPKÉNT a `User` táblára.
--
-- === MIÉRT KAPCSOLÓTÁBLA, ÉS NEM TÖMB-OSZLOP ===
--
-- A séma házi mintája: mérve 2026-09-22, EGYETLEN enum-tömb oszlop sincs benne,
-- a többszörös hozzárendelések mind saját táblában állnak
-- (`ServiceJobAssignee`, `UserWorksheetDepartment`).
--
-- A `role` INDEXELT: a küldés pontosan erre kérdez rá („kinek van meg ez a
-- szerepe"), minden egyes ügyfél-bejelentésnél. Index nélkül ez teljes
-- táblabejárás lenne, bejelentésenként.
--
-- A `Cascade` a felhasználóra: egy törölt felhasználó nem visz magával
-- értesítési szerepet. Itt nincs mit megőrizni -- a szerep nem esemény, hanem
-- beállítás.
CREATE TYPE "NotificationRole" AS ENUM ('SERVICE_JOB_OPENED');

CREATE TABLE "UserNotificationRole" (
    "userId" TEXT NOT NULL,
    "role" "NotificationRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNotificationRole_pkey" PRIMARY KEY ("userId","role")
);

CREATE INDEX "UserNotificationRole_role_idx" ON "UserNotificationRole"("role");

ALTER TABLE "UserNotificationRole" ADD CONSTRAINT "UserNotificationRole_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
