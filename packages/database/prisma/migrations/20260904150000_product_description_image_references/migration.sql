CREATE TABLE "ProductDescriptionImageReference" ("id" TEXT NOT NULL, "productId" TEXT NOT NULL, "descriptionPart" TEXT NOT NULL, "url" TEXT NOT NULL, "host" TEXT, "isOwn" BOOLEAN NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ProductDescriptionImageReference_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ProductDescriptionImageReference_productId_descriptionPart_url_key" ON "ProductDescriptionImageReference"("productId", "descriptionPart", "url");
CREATE INDEX "ProductDescriptionImageReference_isOwn_idx" ON "ProductDescriptionImageReference"("isOwn");
CREATE INDEX "ProductDescriptionImageReference_host_idx" ON "ProductDescriptionImageReference"("host");
ALTER TABLE "ProductDescriptionImageReference" ADD CONSTRAINT "ProductDescriptionImageReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
