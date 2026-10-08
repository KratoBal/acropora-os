-- Szallitasi jellemzok (a82ed229): a lista "OS-UNAS elteres" szurojenek tarolt jelzoje.
-- A meglevo sorokon hamis; a kovetkezo UNAS-szinkron vagy a feltolto beallitja.

-- AlterTable
ALTER TABLE "ProductShippingProfile" ADD COLUMN     "unasDiffers" BOOLEAN NOT NULL DEFAULT false;

