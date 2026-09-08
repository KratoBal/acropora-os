CREATE TYPE "ProductAdvisorKind" AS ENUM ('PLACEMENT', 'CAPACITY');

ALTER TABLE "Product" ADD COLUMN "advisorKind" "ProductAdvisorKind";
