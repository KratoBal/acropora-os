-- Article bodies on content items of the ARTICLE channel, their approved revisions, linked products and taxa (acrobot, 2026-10-26, msg 36158).
-- CreateEnum
CREATE TYPE "ArticleChannel" AS ENUM ('WEBSHOP_BLOG', 'REEFCLUB');

-- CreateTable
CREATE TABLE "ArticleBody" (
    "contentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "coverImageUrl" TEXT,
    "coverImageAlt" TEXT,
    "channels" "ArticleChannel"[],
    "byline" TEXT,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "ogImageUrl" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "approvedRevisionId" TEXT,
    "publishedRevisionId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleBody_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "ArticleRevision" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "coverImageAlt" TEXT,
    "channels" "ArticleChannel"[],
    "byline" TEXT,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "ogImageUrl" TEXT,
    "noindex" BOOLEAN NOT NULL,
    "contentHash" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleProduct" (
    "contentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticleProduct_pkey" PRIMARY KEY ("contentId","productId")
);

-- CreateTable
CREATE TABLE "ArticleTaxon" (
    "contentId" TEXT NOT NULL,
    "taxonKey" VARCHAR(64) NOT NULL,

    CONSTRAINT "ArticleTaxon_pkey" PRIMARY KEY ("contentId","taxonKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleBody_slug_key" ON "ArticleBody"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleBody_approvedRevisionId_key" ON "ArticleBody"("approvedRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleBody_publishedRevisionId_key" ON "ArticleBody"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "ArticleRevision_contentId_approvedAt_idx" ON "ArticleRevision"("contentId", "approvedAt");

-- CreateIndex
CREATE INDEX "ArticleProduct_productId_idx" ON "ArticleProduct"("productId");

-- AddForeignKey
ALTER TABLE "ArticleBody" ADD CONSTRAINT "ArticleBody_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleBody" ADD CONSTRAINT "ArticleBody_approvedRevisionId_fkey" FOREIGN KEY ("approvedRevisionId") REFERENCES "ArticleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleBody" ADD CONSTRAINT "ArticleBody_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "ArticleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ArticleBody"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleProduct" ADD CONSTRAINT "ArticleProduct_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ArticleBody"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleProduct" ADD CONSTRAINT "ArticleProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleTaxon" ADD CONSTRAINT "ArticleTaxon_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ArticleBody"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;
