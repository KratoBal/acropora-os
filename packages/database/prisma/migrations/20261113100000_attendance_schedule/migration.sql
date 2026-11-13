-- The attendance sheet (task os-jelenleti-iv, S1): an employee's weekly schedule versions, and the days that differ from them.
-- New tables only; nothing existing is changed.

-- CreateEnum
CREATE TYPE "AttendanceDayKind" AS ENUM ('WORKED', 'SICK', 'LEAVE', 'DAY_OFF');

-- CreateTable
CREATE TABLE "AttendanceSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceScheduleDay" (
    "scheduleId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,

    CONSTRAINT "AttendanceScheduleDay_pkey" PRIMARY KEY ("scheduleId","weekday")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "AttendanceDayKind" NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSchedule_userId_validFrom_key" ON "AttendanceSchedule"("userId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceDay_userId_date_key" ON "AttendanceDay"("userId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceSchedule" ADD CONSTRAINT "AttendanceSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceScheduleDay" ADD CONSTRAINT "AttendanceScheduleDay_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "AttendanceSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A weekday is ISO (1 Monday ... 7 Sunday); a shift stays within one day and the departure is after the arrival.
ALTER TABLE "AttendanceScheduleDay" ADD CONSTRAINT "AttendanceScheduleDay_range_check"
  CHECK ("weekday" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" < 1440);

-- Times exactly on a WORKED day, and none on a mark: the sheet prints the mark in their place, so a stray time would be
-- printed nowhere and believed somewhere.
ALTER TABLE "AttendanceDay" ADD CONSTRAINT "AttendanceDay_times_check"
  CHECK (
    ("kind" = 'WORKED' AND "startMinute" IS NOT NULL AND "endMinute" IS NOT NULL
      AND "startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" < 1440)
    OR ("kind" <> 'WORKED' AND "startMinute" IS NULL AND "endMinute" IS NULL)
  );
