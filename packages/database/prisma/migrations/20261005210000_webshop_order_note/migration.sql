-- CreateTable
CREATE TABLE "WebshopOrderNote" (
    "orderId" VARCHAR(64) NOT NULL,
    "text" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebshopOrderNote_pkey" PRIMARY KEY ("orderId")
);

