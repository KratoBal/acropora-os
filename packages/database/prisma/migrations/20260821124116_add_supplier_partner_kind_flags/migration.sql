-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "isService" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSupplier" BOOLEAN NOT NULL DEFAULT true;
