-- Szallitasi jellemzok (a82ed229): jelzonkenti forras (UNAS vagy MANUAL) es az uj
-- "csomagautomataba nem fer" jelzo. A meglevo sorok kezzel irottak, ezert MANUAL az alapertek.

-- CreateEnum
CREATE TYPE "ShippingFlagSource" AS ENUM ('UNAS', 'MANUAL');

-- AlterTable
ALTER TABLE "ProductShippingProfile" ADD COLUMN     "foxpostForbiddenSource" "ShippingFlagSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "isFrozenSource" "ShippingFlagSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "isHeavySource" "ShippingFlagSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "lockerUnsuitable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupOnlySource" "ShippingFlagSource" NOT NULL DEFAULT 'MANUAL';

