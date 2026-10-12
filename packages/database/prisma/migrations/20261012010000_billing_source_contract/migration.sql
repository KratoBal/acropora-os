-- A beszerzési szerződésből nyitott számla forrása (hétfői lista M4): a
-- `sourceId` a szerződés azonosítója. Ebből tudja a szerződés, hogy készült-e
-- már belőle számla, és akkor nem állítható vissza karbantartásira.
ALTER TYPE "BillingSourceType" ADD VALUE 'CONTRACT';
