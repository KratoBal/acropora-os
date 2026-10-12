-- SEO P1-14 (C10): the SEO landing page, served at /hu/valogatas/{slug}.
-- CreateTable
CREATE TABLE "SeoLandingPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "intro" TEXT,
    "filterDefinition" JSONB NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoLandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoLandingPage_slug_key" ON "SeoLandingPage"("slug");
