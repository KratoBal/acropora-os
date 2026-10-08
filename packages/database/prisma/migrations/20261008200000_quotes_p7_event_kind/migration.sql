-- #1582 P7: the quote event of a prepared proforma. An enum value goes in its
-- own migration: a value added to an enum cannot be used in the same
-- transaction.

-- AlterEnum
ALTER TYPE "QuoteEventKind" ADD VALUE 'PROFORMA_PREPARED';

