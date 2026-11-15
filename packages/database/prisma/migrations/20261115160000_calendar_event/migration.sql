-- T5.5 S2: the hand-entered calendar events (shop event, holiday).

-- CreateEnum
CREATE TYPE "CalendarEventKind" AS ENUM ('SHOP_EVENT', 'HOLIDAY');

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "kind" "CalendarEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "location" TEXT,
    "responsibleUserId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarEvent_startsOn_endsOn_idx" ON "CalendarEvent"("startsOn", "endsOn");
