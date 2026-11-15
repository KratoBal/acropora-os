-- T5.5 S6: the content calendar's settings, one row; the newsletter frequency stays NULL until Balázs gives it.

-- CreateTable
CREATE TABLE "ContentCalendarSetting" (
    "id" TEXT NOT NULL,
    "newsletterMinDays" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCalendarSetting_pkey" PRIMARY KEY ("id")
);
