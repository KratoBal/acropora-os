-- A NAPI JELÖLÉS KÉZZEL RENDEZETT SORAI (6fd8c574; Balázs, 2026-11-05 16:07 UTC): egy figyelmet kérő tétel, amit egy
-- ember a "Kézzel rendezve" gombbal lezárt (például a cmfx-ben kiállított számla, amit a Számlázz.hu nem ismer). Új,
-- üres tábla, meglévő sort nem érint. ROLLBACK: DROP TABLE "PaidMarkAttentionClosure"; (a lezárások elvesznek, a
-- tételek újra figyelmet kérnek; a történet az AuditLog-ban marad).

-- CreateTable
CREATE TABLE "PaidMarkAttentionClosure" (
    "id" TEXT NOT NULL,
    "source" "OutgoingPaymentMarkSource" NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,

    CONSTRAINT "PaidMarkAttentionClosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaidMarkAttentionClosure_source_key_reason_key" ON "PaidMarkAttentionClosure"("source", "key", "reason");
