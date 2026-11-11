-- V3.4 S2c-2: what the projected reference link IS. MAKER is the manufacturer's page (what every existing row is); SHOP_TEXT is the shop's
-- own product text, which only the manual list can supply and only while the TEST switch is on. The enum is the one the manual list uses.
ALTER TABLE "ReefClubCustomerCandidate"
  ADD COLUMN "referenceKind" "CustomerCandidateBasis" NOT NULL DEFAULT 'MAKER';
