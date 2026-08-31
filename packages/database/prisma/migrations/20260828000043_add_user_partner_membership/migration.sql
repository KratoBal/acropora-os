-- Which partner an account acts on behalf of.
--
-- WHY THIS IS THE FIRST STEP of partner-side access: today nothing on `User`
-- says who the account belongs to, so no query can narrow rows to a partner.
-- Every later filter reads one of these two columns.
--
-- WHY BOTH ARE NULLABLE, and why the check is "at most one" rather than
-- "exactly one" as on `Asset`: every asset has an owner, but most accounts are
-- our own colleagues, who belong to neither. NULL/NULL is therefore the normal
-- state, not a gap to be filled later.
--
-- WHY THE CHECK EXISTS AT ALL: with both columns filled, a filter could not
-- tell which partner's rows to narrow to, and either choice would let foreign
-- data through. The rule is enforced by the database and not only by the code,
-- because the damage would be silent -- a well-formed response that simply
-- contains more than it should.
ALTER TABLE "User" ADD COLUMN "customerId" TEXT;
ALTER TABLE "User" ADD COLUMN "supplierId" TEXT;

-- RESTRICT, not SET NULL, and the difference is a privilege question rather
-- than a referential one. Under SET NULL, deleting a partner would quietly
-- empty both columns, and an account with neither column set reads as "one of
-- our own colleagues" -- so a housekeeping delete would WIDEN that account's
-- access. Under RESTRICT the delete fails loudly and a person decides what
-- should happen to the account.
ALTER TABLE "User"
  ADD CONSTRAINT "User_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "User"
  ADD CONSTRAINT "User_at_most_one_partner_check"
  CHECK (num_nonnulls("customerId", "supplierId") <= 1);

-- The RESTRICT check above runs on every customer and supplier delete, and
-- without these it would scan the whole "User" table each time.
CREATE INDEX "User_customerId_idx" ON "User"("customerId");
CREATE INDEX "User_supplierId_idx" ON "User"("supplierId");
