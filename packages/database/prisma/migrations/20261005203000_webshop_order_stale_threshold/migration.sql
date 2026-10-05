-- CreateEnum
CREATE TYPE "WebshopStaleUnit" AS ENUM ('HOUR', 'DAY');

-- CreateTable
CREATE TABLE "WebshopOrderStaleThreshold" (
    "status" VARCHAR(40) NOT NULL,
    "value" INTEGER NOT NULL,
    "unit" "WebshopStaleUnit" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebshopOrderStaleThreshold_pkey" PRIMARY KEY ("status")
);

