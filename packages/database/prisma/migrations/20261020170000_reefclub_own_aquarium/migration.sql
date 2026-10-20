-- ReefClub, slice 4 (task reefclub-szelet-4, plan v6.1 sections 2.2 and 4.2): the own aquarium
-- of a ReefClub account and the account that recorded a manual measurement. Additive only: two
-- nullable columns with their foreign keys and indexes, and two CHECK constraints that every
-- existing row already satisfies (both new columns are empty on all of them).
-- ROLLBACK: drop the two CHECK constraints, the two foreign keys, the two indexes and the two
-- columns, in that order. No existing column changes, so the internal rows are untouched by
-- either direction; the ReefClub aquariums and their measurements are lost with the columns'
-- meaning, so a rollback after ReefClub use deletes those rows first
-- (DELETE FROM "Aquarium" WHERE "ownerAccountId" IS NOT NULL, measurements cascade).

-- AlterTable
ALTER TABLE "Aquarium" ADD COLUMN     "ownerAccountId" TEXT;

-- AlterTable
ALTER TABLE "AquariumMeasurement" ADD COLUMN     "recordedByAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Aquarium_ownerAccountId_idx" ON "Aquarium"("ownerAccountId");

-- CreateIndex
CREATE INDEX "AquariumMeasurement_recordedByAccountId_idx" ON "AquariumMeasurement"("recordedByAccountId");

-- AddForeignKey
ALTER TABLE "Aquarium" ADD CONSTRAINT "Aquarium_ownerAccountId_fkey" FOREIGN KEY ("ownerAccountId") REFERENCES "ReefClubAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AquariumMeasurement" ADD CONSTRAINT "AquariumMeasurement_recordedByAccountId_fkey" FOREIGN KEY ("recordedByAccountId") REFERENCES "ReefClubAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A ReefClub aquarium has no customer, no site, no responsible colleague and is not maintained
-- by the shop (plan 4.3). The customer and the account are therefore never both the owner. The
-- plan wrote "exactly one"; the shop's own (OWN) aquariums have no customer today, so that form
-- would refuse every one of them.
ALTER TABLE "Aquarium" ADD CONSTRAINT "Aquarium_reefclub_owner_check" CHECK (
  "ownerAccountId" IS NULL OR (
    "customerId" IS NULL
    AND "departmentId" IS NULL
    AND "responsibleUserId" IS NULL
    AND "maintainedByUs" = false
  )
);

-- A measurement is recorded either by a colleague (the old, foreign-key-less "measuredById") or
-- by a ReefClub account, never by both.
ALTER TABLE "AquariumMeasurement" ADD CONSTRAINT "AquariumMeasurement_recorder_check" CHECK (
  num_nonnulls("measuredById", "recordedByAccountId") <= 1
);
