-- The balance after an advance (card d31a66a3, S3): one row per order, after its (advance) receipt. Additive: a new table only.
CREATE TABLE "WebshopBalanceReceipt" (
    "orderId" VARCHAR(64) NOT NULL,
    "source" "WebshopTransferReceiptSource" NOT NULL,
    "bankTransactionId" TEXT,
    "reference" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebshopBalanceReceipt_pkey" PRIMARY KEY ("orderId")
);

CREATE UNIQUE INDEX "WebshopBalanceReceipt_bankTransactionId_key" ON "WebshopBalanceReceipt"("bankTransactionId");

ALTER TABLE "WebshopBalanceReceipt" ADD CONSTRAINT "WebshopBalanceReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "WebshopTransferReceipt"("orderId") ON DELETE RESTRICT ON UPDATE CASCADE;
