-- T5.5 S5: a content item can be a slot of the calendar, opened by a template row for one event. Both columns are
-- empty on the existing items; the unique index allows that (NULLs are distinct), and holds one slot per event and row.

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "calendarEventKey" TEXT,
ADD COLUMN     "templateRuleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_calendarEventKey_templateRuleId_key" ON "ContentItem"("calendarEventKey", "templateRuleId");

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_templateRuleId_fkey" FOREIGN KEY ("templateRuleId") REFERENCES "ContentTemplateRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
