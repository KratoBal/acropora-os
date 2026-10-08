import { Module } from "@nestjs/common";

import { CatalogOptionsController } from "./catalog-options.controller.js";
import { ProductBarcodeController } from "./product-barcode.controller.js";
import { ProductBarcodeRepository } from "./product-barcode.repository.js";
import { ProductBarcodeService } from "./product-barcode.service.js";
import { ProductExtensionController } from "./product-extension.controller.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";
import {
  ProductShippingBulkController,
  ProductShippingProfileController,
} from "./product-shipping-profile.controller.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";
import {
  ENRICHMENT_READER,
  PrismaEnrichmentReader,
} from "./enrichment/enrichment-read.repository.js";
import { ProductEnrichmentQueueController } from "./product-enrichment-queue.controller.js";
import { ProductEnrichmentReviewController } from "./product-enrichment-review.controller.js";
import { ProductEnrichmentReviewService } from "./product-enrichment-review.service.js";
import {
  KNOWLEDGE_STORE,
  PrismaKnowledgeStore,
} from "./knowledge/knowledge.repository.js";
import { ProductKnowledgeController } from "./knowledge/knowledge.controller.js";
import { AttributeController } from "./attributes/attribute.controller.js";
import { ProductKnowledgeService } from "./knowledge/knowledge.service.js";
import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

import { UrlRedirectController } from "./redirect/url-redirect.controller.js";
import {
  REDIRECT_TRANSACTOR,
  UrlRedirectService,
  prismaRedirectTransactor,
} from "./redirect/url-redirect.service.js";
import { WebshopSlugController } from "./slug/webshop-slug.controller.js";
import { PrismaWebshopSlugStore } from "./slug/webshop-slug.repository.js";
import {
  WEBSHOP_SLUG_STORE,
  WebshopSlugService,
} from "./slug/webshop-slug.service.js";
@Module({
  controllers: [
    ProductController,
    ProductBarcodeController,
    ProductExtensionController,
    ProductShippingBulkController,
    ProductShippingProfileController,
    CatalogOptionsController,
    ProductEnrichmentReviewController,
    ProductEnrichmentQueueController,
    ProductKnowledgeController,
    AttributeController,
    WebshopSlugController,
    UrlRedirectController,
  ],
  providers: [
    ProductRepository,
    ProductService,
    ProductBarcodeRepository,
    ProductBarcodeService,
    ProductExtensionRepository,
    ProductShippingProfileRepository,
    ProductShippingProfileService,
    ProductExtensionService,
    ProductEnrichmentReviewService,
    { provide: ENRICHMENT_READER, useClass: PrismaEnrichmentReader },
    ProductKnowledgeService,
    { provide: KNOWLEDGE_STORE, useClass: PrismaKnowledgeStore },
    WebshopSlugService,
    { provide: WEBSHOP_SLUG_STORE, useClass: PrismaWebshopSlugStore },
    UrlRedirectService,
    { provide: REDIRECT_TRANSACTOR, useValue: prismaRedirectTransactor },
  ],
  exports: [ProductService, ProductExtensionService, ProductBarcodeRepository],
})
export class ProductModule {}
