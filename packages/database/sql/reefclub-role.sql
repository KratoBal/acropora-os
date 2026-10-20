-- THE REEFCLUB PROCESS'S DATABASE ROLE (ReefClub plan v6.1, 2.1 and 5.4; slice 6).
--
-- The ReefClub process connects with REEFCLUB_DATABASE_URL, which names this role. It may read and
-- write the ReefClub tables, the own-aquarium side of the aquarium tables, and only the columns of
-- the customer it needs to show a shop link. Everything else (invoices, worksheets, products, the
-- internal users, the customer's phone and e-mail, the aquarium's internal columns) is not
-- readable: a mistake or an injection in the ReefClub process cannot hand it out.
--
-- HOW IT IS APPLIED. Not a Prisma migration: the role is per environment (its password is a secret
-- of that environment), and a migration naming a role that does not exist would stop every
-- deployment. An operator applies it, after `prisma migrate deploy`, with a role that owns the
-- tables:
--
--   CREATE ROLE "reefclub_app" LOGIN PASSWORD '...';      -- once per environment, secret
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database/sql/reefclub-role.sql
--
-- It is idempotent: it first takes every table right away from the role, then grants this list.
-- A NEW TABLE OR COLUMN THE REEFCLUB PROCESS USES NEEDS A LINE HERE: the integration spec
-- `reefclub-szerep.integration.spec.ts` runs the ReefClub flows with exactly this file applied,
-- so a missing grant is a red test, not a production error.
--
-- Foreign-key actions (the account's final deletion cascading to its aquariums and their rows) run
-- with the table owner's rights, so the cascade needs no DELETE right on the child tables.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "reefclub_app";
GRANT USAGE ON SCHEMA public TO "reefclub_app";

-- The ReefClub's own tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ReefClubAccount",
  "ReefClubSession",
  "ReefClubAccountToken",
  "ReefClubIdentity",
  "ReefClubAccountDeletion"
TO "reefclub_app";
GRANT SELECT, INSERT, UPDATE ON "ReefClubCustomerLink" TO "reefclub_app";
GRANT SELECT, UPDATE ON "ReefClubLinkCode" TO "reefclub_app";

-- The customer: only what a shop link shows and checks (plan 2.1: never the phone or e-mail).
GRANT SELECT ("id", "displayName", "type", "isActive") ON "Customer" TO "reefclub_app";

-- The aquarium: the own-aquarium columns. Not "notes", "maintainedByUs", "responsibleUserId",
-- "departmentId" (plan 2.1 and 4.3).
GRANT SELECT (
  "id", "ownerAccountId", "customerId", "name", "waterBodyType", "waterType",
  "systemVolumeLiters", "sharedWithShopAt", "isActive", "createdAt"
) ON "Aquarium" TO "reefclub_app";
-- Prisma writes the client-side defaults too ("maintainedByUs" false, "isActive" true, "createdAt"):
-- inserting them is no reading right, and the Aquarium_reefclub_owner_check keeps "maintainedByUs"
-- false on a ReefClub aquarium whatever is sent.
GRANT INSERT (
  "id", "aquariumNumber", "ownerAccountId", "ownershipType", "name", "waterBodyType", "waterType",
  "systemVolumeLiters", "systemVolumeIsManual", "maintainedByUs", "isActive", "createdAt",
  "updatedAt"
) ON "Aquarium" TO "reefclub_app";
GRANT UPDATE (
  "name", "waterBodyType", "waterType", "systemVolumeLiters", "systemVolumeIsManual",
  "sharedWithShopAt", "shareConsentVersion", "updatedAt"
) ON "Aquarium" TO "reefclub_app";
GRANT DELETE ON "Aquarium" TO "reefclub_app";

-- The measurements: not "measuredById" (the colleague) and not "notes".
GRANT SELECT (
  "id", "aquariumId", "parameterCode", "value", "unit", "measuredAt", "source",
  "clientOperationId", "recordedByAccountId"
) ON "AquariumMeasurement" TO "reefclub_app";
GRANT INSERT (
  "id", "aquariumId", "parameterCode", "value", "unit", "measuredAt", "source",
  "clientOperationId", "recordedByAccountId", "createdAt"
) ON "AquariumMeasurement" TO "reefclub_app";
GRANT DELETE ON "AquariumMeasurement" TO "reefclub_app";

GRANT SELECT, INSERT, UPDATE, DELETE ON "AquariumMeasurementTarget" TO "reefclub_app";

-- The release of a shop occasion: which occasions may be shown.
-- (Prisma reads the key with every row.)
GRANT SELECT ("id", "aquariumId", "measuredAt") ON "AquariumMeasurementRelease" TO "reefclub_app";

-- The share log: written, never read (the colleagues' read entries are in it).
GRANT INSERT ("id", "aquariumId", "kind", "accountId", "consentVersion", "createdAt")
  ON "AquariumShareEvent" TO "reefclub_app";
