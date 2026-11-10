-- THE USAGE GUIDE COPY BLOCK (V3.3, card 69b5f2ef). One new enum value; no row is touched.
-- ROLLBACK: PostgreSQL cannot drop an enum value. Delete the "usage" rows of "ProductKnowledgeCopy" first, then recreate the
-- type without the value (ALTER TYPE ... RENAME, CREATE TYPE, ALTER COLUMN ... USING, DROP TYPE), as for any enum value.
-- AlterEnum
ALTER TYPE "ProductCopyBlock" ADD VALUE 'usage';
