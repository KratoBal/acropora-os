-- The web shop's home page content (Balázs, 2026-10-20): the text overrides and the hero slides.
-- CreateTable
CREATE TABLE "HomepageContent" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "texts" JSONB NOT NULL,
    "slides" JSONB,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomepageContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomepageContent_key_key" ON "HomepageContent"("key");
