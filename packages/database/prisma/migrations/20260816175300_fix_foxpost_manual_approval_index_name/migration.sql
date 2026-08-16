-- A 20260815100000_add_foxpost_manual_line_approval migráció kézzel írt
-- indexneve 65 karakter volt, amit a PostgreSQL 63 karakterre csonkolt
-- ("..._manualApprovedAt_i"). A Prisma a @@index([manualApprovedByUserId,
-- manualApprovedAt]) alapján ettől eltérő, szabályosan rövidített nevet vár,
-- ezért minden `prisma migrate dev` újra és újra ezt az átnevezést javasolta.
-- Ez a migráció csak az indexet nevezi át; adatot és sémát nem érint.
ALTER INDEX "FoxpostSettlementLine_manualApprovedByUserId_manualApprovedAt_i"
RENAME TO "FoxpostSettlementLine_manualApprovedByUserId_manualApproved_idx";
