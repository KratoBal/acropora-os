-- The attendance sheet printed for signature (task os-jelenleti-iv, S2d): the PDF as handed out, and the hash of the
-- sheet it shows. A new table only; nothing existing is changed.

-- CreateTable
CREATE TABLE "AttendanceSignedSheet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "pdf" BYTEA NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL,
    "printedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSignedSheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceSignedSheet_userId_month_printedAt_idx" ON "AttendanceSignedSheet"("userId", "month", "printedAt");

-- AddForeignKey
ALTER TABLE "AttendanceSignedSheet" ADD CONSTRAINT "AttendanceSignedSheet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

