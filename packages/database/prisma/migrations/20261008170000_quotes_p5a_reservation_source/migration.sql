-- #1582 P5a (B2 RESOLVED): a project reservation moves the free stock the
-- shop sees. Its own migration: a value added to an enum cannot be used in
-- the same transaction.
ALTER TYPE "UnasStockSyncSourceProcess" ADD VALUE 'PROJECT_RESERVATION';
