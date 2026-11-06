-- ONE PARTNER REGISTER, STEP 4 PREREQUISITE (plan 3.4, decided by the owner's agent on 2026-11-04: variant (a)).
-- A merged company is ONE Customer row that carries several UNAS accounts (a zoo orders from more than one e-mail address, and
-- each account used to become a customer row of its own). So for entityType 'Customer' the pair (system, entityType, entityId)
-- may now repeat; it stays UNIQUE for every other entity type (products, brands, categories, ...), where it still means "one
-- external record per entity". The pair (system, entityType, externalId) is untouched: one external account still maps to exactly
-- one entity, which is what the UNAS sync looks up by.
--
-- The index keeps its Prisma-generated name, and the schema keeps declaring @@unique([system, entityType, entityId]) (the
-- compound key accessor is used by many repositories); only this index's predicate differs. Prisma cannot express a partial
-- index, so a `prisma migrate dev` may propose to restore the full one: that proposal must be dropped
-- (`external-reference-schema-guard.test.ts` turns red when a later migration brings it back).
--
-- ROLLBACK (only valid while no entity has two Customer references; check first):
--   DROP INDEX "ExternalReference_system_entityType_entityId_key";
--   CREATE UNIQUE INDEX "ExternalReference_system_entityType_entityId_key" ON "ExternalReference"("system", "entityType", "entityId");
DROP INDEX "ExternalReference_system_entityType_entityId_key";

CREATE UNIQUE INDEX "ExternalReference_system_entityType_entityId_key"
  ON "ExternalReference"("system", "entityType", "entityId")
  WHERE "entityType" <> 'Customer';
