-- The Lejáró számlák weekly mail settings (acrobot 58227, 58230, 58274): one row, recipients, sender, weekday, earliest and latest time, and the trace of the last send.

-- CreateTable
CREATE TABLE "DueInvoicesMailSetting" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromAddress" TEXT,
    "weekday" INTEGER NOT NULL DEFAULT 1,
    "earliest" TEXT NOT NULL DEFAULT '07:00',
    "latest" TEXT NOT NULL DEFAULT '12:00',
    "lastSentDay" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "lastSentRecipients" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DueInvoicesMailSetting_pkey" PRIMARY KEY ("id")
);

