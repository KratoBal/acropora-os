-- A NAV számlaművelet a bejövő számlán (acrobot 25624, 25649): a módosító és a
-- sztornó okirat is bekerül, a művelettel és az eredeti számla sorszámával.
-- A meglévő sorok mind alapszámlák (a v1 csak CREATE tételt tárolt), ezért az
-- alapértelmezés CREATE.

-- CreateEnum
CREATE TYPE "NavInvoiceOperation" AS ENUM ('CREATE', 'MODIFY', 'STORNO');

-- AlterTable
ALTER TABLE "NavIncomingInvoice" ADD COLUMN     "invoiceOperation" "NavInvoiceOperation" NOT NULL DEFAULT 'CREATE',
ADD COLUMN     "modificationIndex" INTEGER,
ADD COLUMN     "originalInvoiceNumber" TEXT;
