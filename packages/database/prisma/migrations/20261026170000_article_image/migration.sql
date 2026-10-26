-- CreateTable
CREATE TABLE "ArticleImage" (
    "id" TEXT NOT NULL,
    "contentId" TEXT,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArticleImage_contentId_idx" ON "ArticleImage"("contentId");

-- CreateIndex
CREATE INDEX "ArticleImage_sha256_idx" ON "ArticleImage"("sha256");

