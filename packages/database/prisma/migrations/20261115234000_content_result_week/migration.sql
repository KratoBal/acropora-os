-- T5.5 S8: a sent content item's numbers per Budapest week, entered by hand.

-- CreateTable
CREATE TABLE "ContentResultWeek" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "reach" INTEGER,
    "reactions" INTEGER,
    "opens" INTEGER,
    "clicks" INTEGER,
    "preorders" INTEGER,
    "orders" INTEGER,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentResultWeek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentResultWeek_contentId_weekStart_key" ON "ContentResultWeek"("contentId", "weekStart");

-- AddForeignKey
ALTER TABLE "ContentResultWeek" ADD CONSTRAINT "ContentResultWeek_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
