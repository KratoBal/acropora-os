-- Card f6694b49: a marker for the machine (fleet) accounts, so the operations log participant list can leave them out.
-- Additive: a NOT NULL column with a default, no existing row changes meaning.
ALTER TABLE "User" ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- The two fleet accounts known today (ids from the live system, acrobot 2026-11-15: "Acrobot (flotta)", "Acrobot Szerviz").
-- On a database that does not have these ids (CI, a local copy, the anonymised stage) this updates 0 rows and changes nothing.
UPDATE "User" SET "isServiceAccount" = true
WHERE "id" IN ('cmvaxz5di00gfrm07p66vb342', 'cmue57fo6001rmi07maad7vwx');
