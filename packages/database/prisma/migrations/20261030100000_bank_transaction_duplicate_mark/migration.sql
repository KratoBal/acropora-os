-- Bank-import dupla sorok (task bank-dupla-import, acrobot 38352): a kezelo egy bank-sort DUPLIKATUMNAK jelolhet. A jelolt sort a
-- Hianyzo szamlak listai es osszegzesei, a parositasok es a banki felismerok kihagyjak; a sor MARAD (az import forras-kulcsait
-- hordozza, ezert egy ujrafeltoltes nem hozza vissza), es a jelolest vissza lehet vonni. Csak uj, nullable oszlopok; a meglevo
-- sorok nem valtoznak.
-- ROLLBACK: ALTER TABLE "BankTransaction" DROP COLUMN "duplicateMarkedAt", DROP COLUMN "duplicateMarkedByUserId", DROP COLUMN "duplicateOfId";
ALTER TABLE "BankTransaction" ADD COLUMN     "duplicateMarkedAt" TIMESTAMP(3),
ADD COLUMN     "duplicateMarkedByUserId" TEXT,
ADD COLUMN     "duplicateOfId" TEXT;
