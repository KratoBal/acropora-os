-- T5.2: an output edited outside the source (the "differs from the source"
-- mark): the uploaded file, the slide text read from it, the editor's decision.

-- CreateTable
CREATE TABLE "TeachingOutputEdit" (
    "id" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "slides" JSONB NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toSource" BOOLEAN,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "TeachingOutputEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeachingOutputEdit_outputId_uploadedAt_idx" ON "TeachingOutputEdit"("outputId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "TeachingOutputEdit" ADD CONSTRAINT "TeachingOutputEdit_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "TeachingOutput"("id") ON DELETE CASCADE ON UPDATE CASCADE;

