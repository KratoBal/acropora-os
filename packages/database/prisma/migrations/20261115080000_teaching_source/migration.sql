-- T5.2: the teaching source (one source, generated outputs). A content item on the
-- new TEACHING_SOURCE channel holds one TeachingSource; every content change writes
-- an unchangeable TeachingSourceVersion row.

-- CreateEnum
CREATE TYPE "TeachingAudience" AS ENUM ('INTERNAL', 'PUBLIC');

-- AlterEnum
ALTER TYPE "ContentChannel" ADD VALUE 'TEACHING_SOURCE';

-- CreateTable
CREATE TABLE "TeachingSource" (
    "contentId" TEXT NOT NULL,
    "subtitle" TEXT,
    "author" TEXT NOT NULL,
    "editor" TEXT,
    "audience" "TeachingAudience" NOT NULL DEFAULT 'INTERNAL',
    "publicBasis" TEXT,
    "disclaimer" TEXT,
    "document" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "approvedVersion" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeachingSource_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "TeachingSourceVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "author" TEXT NOT NULL,
    "editor" TEXT,
    "audience" "TeachingAudience" NOT NULL,
    "publicBasis" TEXT,
    "disclaimer" TEXT,
    "document" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachingSourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeachingSourceVersion_contentId_version_key" ON "TeachingSourceVersion"("contentId", "version");

-- AddForeignKey
ALTER TABLE "TeachingSource" ADD CONSTRAINT "TeachingSource_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingSourceVersion" ADD CONSTRAINT "TeachingSourceVersion_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "TeachingSource"("contentId") ON DELETE CASCADE ON UPDATE CASCADE;

