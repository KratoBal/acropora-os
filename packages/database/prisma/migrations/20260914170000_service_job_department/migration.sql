-- A ticket learns where the fault is.
--
-- Until now only the worksheet and the asset knew the site; the REPORT itself,
-- the first link in the chain, did not. After the fact nobody could say which
-- unit a ticket had been opened about.
--
-- Nullable on purpose, for two separate reasons. Existing rows: at this moment
-- no ticket has a site, and a NOT NULL column would either lie or fail here.
-- Present behaviour: a ticket may be opened without a partner at all, and only
-- a partner has sites.
--
-- RESTRICT, not SET NULL: a site with an open ticket on it cannot be deleted
-- from under it. The tree is retired by archiving (isActive), never by delete,
-- so RESTRICT only makes that rule explicit at the database level.

ALTER TABLE "ServiceJob" ADD COLUMN "departmentId" TEXT;

ALTER TABLE "ServiceJob"
    ADD CONSTRAINT "ServiceJob_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "WorksheetDepartment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ServiceJob_departmentId_idx" ON "ServiceJob"("departmentId");
