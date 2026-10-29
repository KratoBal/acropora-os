-- POS: KASSZA FIZETESI MOD (task pos-penztargep-kassza). A CASH ertek marad
-- (a pentzargepen atmeno keszpenz, a feluleten "Penztargep"), az uj CASH_DESK
-- a kasszaba kerulo keszpenz, ami nem megy at a penztargepen. A meglevo
-- eladasok sora nem valtozik.
ALTER TYPE "PosPaymentMethod" ADD VALUE 'CASH_DESK';
