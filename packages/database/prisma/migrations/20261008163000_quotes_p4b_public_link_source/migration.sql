-- #1582 P4b: the customer accepted on the public link. Its own migration: a
-- value added to an enum cannot be used in the same transaction (the CHECKs
-- of the next migration use it).
ALTER TYPE "QuoteAcceptanceSource" ADD VALUE 'PUBLIC_LINK';
