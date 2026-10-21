-- Product Knowledge 2. lepes (kartya 85c38ab1): a szabaly szerint, automatikusan
-- elfogadott teny jelolese. NULL = ember fogadta el: minden mai sor ilyen, tehat
-- adatmozgas es backfill nincs. Az ilyen tenyt a Medusa-vetites nem viszi ki.

-- AlterTable
ALTER TABLE "ProductKnowledgeFact" ADD COLUMN     "acceptedByRule" VARCHAR(32);
