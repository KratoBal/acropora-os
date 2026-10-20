-- THE REEFCLUB PROCESS'S DATABASE ROLE (ReefClub plan v6.1, 2.1 and 5.4; slice 6).
--
-- The ReefClub process connects with REEFCLUB_DATABASE_URL, which names this role. It may read and
-- write the ReefClub tables, the own-aquarium side of the aquarium tables, and only the columns of
-- the customer it needs to show a shop link. Everything else (invoices, worksheets, products, the
-- internal users, the customer's phone and e-mail, the aquarium's internal columns) is not
-- readable: a mistake or an injection in the ReefClub process cannot hand it out.
--
-- The WRITES are bound to rows too, not only to tables and columns (row-level security at the end
-- of this file; barracuda, #1730): the role writes only ReefClub aquariums and their rows, and ends
-- links but never reopens them. Codes and new links go only through the redemption function
-- (`reefclub_redeem_link_code`): the role cannot read a code. Without this a mistake there could
-- delete a shop aquarium, with its internal measurements by the cascade, or link the account to a
-- customer whose code it read.
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
GRANT SELECT ON "ReefClubCustomerLink" TO "reefclub_app";
-- Ending a link is the only change the ReefClub makes to one.
GRANT UPDATE ("status", "endedAt", "endedBy") ON "ReefClubCustomerLink" TO "reefclub_app";
-- A code is redeemed, and the link written, only by this function (migration 20261021000000): the
-- role has no right on "ReefClubLinkCode" and cannot insert a link, so it cannot claim a code whose
-- hash it was not given. The GRANT fails if the function is missing, so the file cannot be applied
-- before that migration.
GRANT EXECUTE ON FUNCTION "reefclub_redeem_link_code"(text, text) TO "reefclub_app";

-- The automatic recommendation (plan 6.1, slice 8): the log of the issued doses, and the dose the
-- customer recorded as given. The log's status and feedback time are the only columns that change
-- after the insert; the recorded dose is written and read, never changed or deleted from here (a
-- wrong entry is the customer's to record again, not to rewrite: the limit counts what was
-- recorded). Neither table is ever deleted from by the role; the account's or the aquarium's
-- deletion cascades with the owner's rights.
GRANT SELECT, INSERT ON "ReefClubRecommendation" TO "reefclub_app";
GRANT UPDATE ("status", "feedbackAt") ON "ReefClubRecommendation" TO "reefclub_app";
GRANT SELECT, INSERT ON "ReefClubAdministeredDose" TO "reefclub_app";

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

-- ROW-LEVEL SECURITY: WHICH ROWS THE ROLE MAY WRITE.
--
-- Enabling it binds every role that does not own the table, so each table first gets one
-- permissive policy for everyone: the other roles keep exactly the rights their grants give them.
-- The table owner (the API's own connection, the migrations, the foreign-key actions) is not
-- bound by row-level security at all. The ReefClub role then gets RESTRICTIVE policies, which
-- hold on top of the permissive one. Reading is not narrowed here (the access function decides
-- which shop aquarium an account sees); only writing is. A write the policies refuse is no error
-- for UPDATE and DELETE (no row matches) and "new row violates row-level security policy" for
-- INSERT. Dropped first, so the file stays idempotent.
--
-- EVERY OUTER COLUMN IN A SUBQUERY IS QUALIFIED WITH ITS TABLE (barracuda, #1748). Unqualified, a
-- name binds to the innermost FROM item that has it: the link policy's `c."customerId" =
-- "customerId"` compared the code's own column with itself, always true, so a claimed code of one
-- customer let the role link the account to any other customer. Today the other subqueries' names
-- happen to resolve outward; a column added later would turn them the same way, silently.

ALTER TABLE "Aquarium" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AquariumMeasurement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AquariumMeasurementTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AquariumShareEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReefClubCustomerLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReefClubLinkCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReefClubRecommendation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReefClubAdministeredDose" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Aquarium_all_roles" ON "Aquarium";
CREATE POLICY "Aquarium_all_roles" ON "Aquarium" AS PERMISSIVE FOR ALL TO PUBLIC
  USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "AquariumMeasurement_all_roles" ON "AquariumMeasurement";
CREATE POLICY "AquariumMeasurement_all_roles" ON "AquariumMeasurement" AS PERMISSIVE FOR ALL
  TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "AquariumMeasurementTarget_all_roles" ON "AquariumMeasurementTarget";
CREATE POLICY "AquariumMeasurementTarget_all_roles" ON "AquariumMeasurementTarget" AS PERMISSIVE
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "AquariumShareEvent_all_roles" ON "AquariumShareEvent";
CREATE POLICY "AquariumShareEvent_all_roles" ON "AquariumShareEvent" AS PERMISSIVE FOR ALL
  TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ReefClubCustomerLink_all_roles" ON "ReefClubCustomerLink";
CREATE POLICY "ReefClubCustomerLink_all_roles" ON "ReefClubCustomerLink" AS PERMISSIVE FOR ALL
  TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ReefClubLinkCode_all_roles" ON "ReefClubLinkCode";
CREATE POLICY "ReefClubLinkCode_all_roles" ON "ReefClubLinkCode" AS PERMISSIVE FOR ALL
  TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ReefClubRecommendation_all_roles" ON "ReefClubRecommendation";
CREATE POLICY "ReefClubRecommendation_all_roles" ON "ReefClubRecommendation" AS PERMISSIVE
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ReefClubAdministeredDose_all_roles" ON "ReefClubAdministeredDose";
CREATE POLICY "ReefClubAdministeredDose_all_roles" ON "ReefClubAdministeredDose" AS PERMISSIVE
  FOR ALL TO PUBLIC USING (true) WITH CHECK (true);

-- The aquarium: only a ReefClub one (it has an owner account) is created, changed or deleted.
DROP POLICY IF EXISTS "Aquarium_reefclub_insert" ON "Aquarium";
CREATE POLICY "Aquarium_reefclub_insert" ON "Aquarium" AS RESTRICTIVE FOR INSERT
  TO "reefclub_app" WITH CHECK ("ownerAccountId" IS NOT NULL);
DROP POLICY IF EXISTS "Aquarium_reefclub_update" ON "Aquarium";
CREATE POLICY "Aquarium_reefclub_update" ON "Aquarium" AS RESTRICTIVE FOR UPDATE
  TO "reefclub_app" USING ("ownerAccountId" IS NOT NULL) WITH CHECK ("ownerAccountId" IS NOT NULL);
DROP POLICY IF EXISTS "Aquarium_reefclub_delete" ON "Aquarium";
CREATE POLICY "Aquarium_reefclub_delete" ON "Aquarium" AS RESTRICTIVE FOR DELETE
  TO "reefclub_app" USING ("ownerAccountId" IS NOT NULL);

-- A measurement: the ReefClub's own manual row, on a ReefClub aquarium, recorded by its owner.
DROP POLICY IF EXISTS "AquariumMeasurement_reefclub_insert" ON "AquariumMeasurement";
CREATE POLICY "AquariumMeasurement_reefclub_insert" ON "AquariumMeasurement" AS RESTRICTIVE
  FOR INSERT TO "reefclub_app" WITH CHECK (
    "source" = 'REEFCLUB_MANUAL' AND EXISTS (
      SELECT 1 FROM "Aquarium" a
      WHERE a."id" = "AquariumMeasurement"."aquariumId"
        AND a."ownerAccountId" = "AquariumMeasurement"."recordedByAccountId"
    )
  );
DROP POLICY IF EXISTS "AquariumMeasurement_reefclub_delete" ON "AquariumMeasurement";
CREATE POLICY "AquariumMeasurement_reefclub_delete" ON "AquariumMeasurement" AS RESTRICTIVE
  FOR DELETE TO "reefclub_app" USING (
    "source" = 'REEFCLUB_MANUAL' AND EXISTS (
      SELECT 1 FROM "Aquarium" a WHERE a."id" = "AquariumMeasurement"."aquariumId" AND a."ownerAccountId" IS NOT NULL
    )
  );

-- A target range: only on a ReefClub aquarium (it is read on a shop aquarium, not written).
DROP POLICY IF EXISTS "AquariumMeasurementTarget_reefclub_insert" ON "AquariumMeasurementTarget";
CREATE POLICY "AquariumMeasurementTarget_reefclub_insert" ON "AquariumMeasurementTarget"
  AS RESTRICTIVE FOR INSERT TO "reefclub_app" WITH CHECK (EXISTS (
    SELECT 1 FROM "Aquarium" a WHERE a."id" = "AquariumMeasurementTarget"."aquariumId" AND a."ownerAccountId" IS NOT NULL
  ));
DROP POLICY IF EXISTS "AquariumMeasurementTarget_reefclub_update" ON "AquariumMeasurementTarget";
CREATE POLICY "AquariumMeasurementTarget_reefclub_update" ON "AquariumMeasurementTarget"
  AS RESTRICTIVE FOR UPDATE TO "reefclub_app"
  USING (EXISTS (
    SELECT 1 FROM "Aquarium" a WHERE a."id" = "AquariumMeasurementTarget"."aquariumId" AND a."ownerAccountId" IS NOT NULL
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Aquarium" a WHERE a."id" = "AquariumMeasurementTarget"."aquariumId" AND a."ownerAccountId" IS NOT NULL
  ));
DROP POLICY IF EXISTS "AquariumMeasurementTarget_reefclub_delete" ON "AquariumMeasurementTarget";
CREATE POLICY "AquariumMeasurementTarget_reefclub_delete" ON "AquariumMeasurementTarget"
  AS RESTRICTIVE FOR DELETE TO "reefclub_app" USING (EXISTS (
    SELECT 1 FROM "Aquarium" a WHERE a."id" = "AquariumMeasurementTarget"."aquariumId" AND a."ownerAccountId" IS NOT NULL
  ));

-- The share log: an entry of the aquarium's own owner only.
DROP POLICY IF EXISTS "AquariumShareEvent_reefclub_insert" ON "AquariumShareEvent";
CREATE POLICY "AquariumShareEvent_reefclub_insert" ON "AquariumShareEvent" AS RESTRICTIVE
  FOR INSERT TO "reefclub_app" WITH CHECK (EXISTS (
    SELECT 1 FROM "Aquarium" a
    WHERE a."id" = "AquariumShareEvent"."aquariumId"
      AND a."ownerAccountId" = "AquariumShareEvent"."accountId"
  ));

-- A link: created active, only with a code of the same customer that this account claimed; an
-- active link may only be ended (by the account), and an ended one is never reopened. The role has
-- no INSERT on links and no right on codes today (the function writes both); the INSERT and the
-- code policies stay as a second line, should a grant come back.
DROP POLICY IF EXISTS "ReefClubCustomerLink_reefclub_insert" ON "ReefClubCustomerLink";
CREATE POLICY "ReefClubCustomerLink_reefclub_insert" ON "ReefClubCustomerLink" AS RESTRICTIVE
  FOR INSERT TO "reefclub_app" WITH CHECK (
    "status" = 'ACTIVE' AND EXISTS (
      SELECT 1 FROM "ReefClubLinkCode" c
      WHERE c."id" = "ReefClubCustomerLink"."codeId"
        AND c."customerId" = "ReefClubCustomerLink"."customerId"
        AND c."usedByAccountId" = "ReefClubCustomerLink"."accountId"
    )
  );
DROP POLICY IF EXISTS "ReefClubCustomerLink_reefclub_update" ON "ReefClubCustomerLink";
CREATE POLICY "ReefClubCustomerLink_reefclub_update" ON "ReefClubCustomerLink" AS RESTRICTIVE
  FOR UPDATE TO "reefclub_app"
  USING ("status" = 'ACTIVE')
  WITH CHECK ("status" = 'ENDED' AND "endedBy" = 'ACCOUNT');

-- A code: claimed once, while valid, for an active person customer; a claim is never undone.
-- "expiresAt" is a timestamp without time zone that Prisma writes in UTC: compared with now()
-- it would be read in the session's time zone (hours off outside UTC), hence the UTC form.
DROP POLICY IF EXISTS "ReefClubLinkCode_reefclub_update" ON "ReefClubLinkCode";
CREATE POLICY "ReefClubLinkCode_reefclub_update" ON "ReefClubLinkCode" AS RESTRICTIVE
  FOR UPDATE TO "reefclub_app"
  USING ("usedAt" IS NULL AND "expiresAt" > (now() AT TIME ZONE 'UTC') AND EXISTS (
    SELECT 1 FROM "Customer" cu
    WHERE cu."id" = "ReefClubLinkCode"."customerId" AND cu."type" = 'PERSON' AND cu."isActive"
  ))
  WITH CHECK ("usedAt" IS NOT NULL AND "usedByAccountId" IS NOT NULL);

-- The automatic recommendation (slice 8). A row is written for an aquarium the account owns, or
-- one whose customer the account has an ACTIVE link to (the shop aquarium it may read), never for
-- another account's. A new recommendation is OPEN; the only change after that is the customer's
-- feedback, once (an answered one stays as answered). "Given" and "partly" need the recorded dose
-- of the same account and aquarium (barracuda, #1753): the limit counts a given recommendation
-- by that dose, so a status set without it would free the limit. The service writes the dose
-- first, then the status, in one transaction. A recorded dose that names a
-- recommendation names one of the same aquarium and the same account.
DROP POLICY IF EXISTS "ReefClubRecommendation_reefclub_insert" ON "ReefClubRecommendation";
CREATE POLICY "ReefClubRecommendation_reefclub_insert" ON "ReefClubRecommendation" AS RESTRICTIVE
  FOR INSERT TO "reefclub_app" WITH CHECK (
    "status" = 'OPEN' AND "feedbackAt" IS NULL AND EXISTS (
      SELECT 1 FROM "Aquarium" a
      WHERE a."id" = "ReefClubRecommendation"."aquariumId"
        AND (
          a."ownerAccountId" = "ReefClubRecommendation"."accountId"
          OR EXISTS (
            SELECT 1 FROM "ReefClubCustomerLink" l
            WHERE l."accountId" = "ReefClubRecommendation"."accountId"
              AND l."customerId" = a."customerId"
              AND l."status" = 'ACTIVE'
          )
        )
    )
  );
DROP POLICY IF EXISTS "ReefClubRecommendation_reefclub_update" ON "ReefClubRecommendation";
CREATE POLICY "ReefClubRecommendation_reefclub_update" ON "ReefClubRecommendation" AS RESTRICTIVE
  FOR UPDATE TO "reefclub_app"
  USING ("status" = 'OPEN')
  WITH CHECK (
    "feedbackAt" IS NOT NULL AND (
      "status" = 'NOT_GIVEN' OR (
        "status" IN ('GIVEN', 'PARTIAL') AND EXISTS (
          SELECT 1 FROM "ReefClubAdministeredDose" d
          WHERE d."recommendationId" = "ReefClubRecommendation"."id"
            AND d."accountId" = "ReefClubRecommendation"."accountId"
            AND d."aquariumId" = "ReefClubRecommendation"."aquariumId"
        )
      )
    )
  );

DROP POLICY IF EXISTS "ReefClubAdministeredDose_reefclub_insert" ON "ReefClubAdministeredDose";
CREATE POLICY "ReefClubAdministeredDose_reefclub_insert" ON "ReefClubAdministeredDose" AS RESTRICTIVE
  FOR INSERT TO "reefclub_app" WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Aquarium" a
      WHERE a."id" = "ReefClubAdministeredDose"."aquariumId"
        AND (
          a."ownerAccountId" = "ReefClubAdministeredDose"."accountId"
          OR EXISTS (
            SELECT 1 FROM "ReefClubCustomerLink" l
            WHERE l."accountId" = "ReefClubAdministeredDose"."accountId"
              AND l."customerId" = a."customerId"
              AND l."status" = 'ACTIVE'
          )
        )
    )
    AND (
      "recommendationId" IS NULL OR EXISTS (
        SELECT 1 FROM "ReefClubRecommendation" r
        WHERE r."id" = "ReefClubAdministeredDose"."recommendationId"
          AND r."aquariumId" = "ReefClubAdministeredDose"."aquariumId"
          AND r."accountId" = "ReefClubAdministeredDose"."accountId"
      )
    )
  );
