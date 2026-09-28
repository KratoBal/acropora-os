-- A levelsablonba beagyazhato kepek tablaja. Uj tabla, a meglevo sorokhoz nem nyul.
-- Az indoklas a schema.prisma-ban all: ez a fajl alkalmazas utan befagy.


-- CreateTable
CREATE TABLE "MailImage" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailImage_sha256_key" ON "MailImage"("sha256");

-- CreateIndex
CREATE INDEX "MailImage_uploadedById_idx" ON "MailImage"("uploadedById");

-- AddForeignKey
ALTER TABLE "MailImage" ADD CONSTRAINT "MailImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

