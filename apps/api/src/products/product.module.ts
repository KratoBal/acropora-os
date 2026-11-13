import { Module } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { CatalogOptionsController } from "./catalog-options.controller.js";
import { ProductBarcodeController } from "./product-barcode.controller.js";
import { ProductBarcodeRepository } from "./product-barcode.repository.js";
import { ProductBarcodeService } from "./product-barcode.service.js";
import { ProductExtensionController } from "./product-extension.controller.js";
import { ProductExtensionRepository } from "./product-extension.repository.js";
import { ProductExtensionService } from "./product-extension.service.js";
import { ProductHusbandryController } from "./product-husbandry.controller.js";
import { ProductHusbandryRepository } from "./product-husbandry.repository.js";
import { ProductHusbandryService } from "./product-husbandry.service.js";
import { ProductShippingProfileBulkController } from "./product-shipping-profile-bulk.controller.js";
import { ProductShippingProfileController } from "./product-shipping-profile.controller.js";
import { ShippingProfileFillController } from "./shipping-profile-fill.controller.js";
import {
  ShippingProfileFillRepository,
  ShippingProfileFillService,
} from "./shipping-profile-fill.service.js";
import { ProductShippingProfileRepository } from "./product-shipping-profile.repository.js";
import { ProductShippingProfileService } from "./product-shipping-profile.service.js";
import {
  ENRICHMENT_READER,
  PrismaEnrichmentReader,
} from "./enrichment/enrichment-read.repository.js";
import { ProductEnrichmentQueueController } from "./product-enrichment-queue.controller.js";
import { ProductEnrichmentRunsController } from "./product-enrichment-runs.controller.js";
import {
  ENRICHMENT_RUNS_READER,
  PrismaEnrichmentRunsReader,
} from "./enrichment/enrichment-runs.read.js";
import { ProductEnrichmentReviewController } from "./product-enrichment-review.controller.js";
import { ProductEnrichmentReviewService } from "./product-enrichment-review.service.js";
import {
  KNOWLEDGE_STORE,
  PrismaKnowledgeStore,
} from "./knowledge/knowledge.repository.js";
import { ProductKnowledgeController } from "./knowledge/knowledge.controller.js";
import { AttributeController } from "./attributes/attribute.controller.js";
import { AttributeSetAdminService } from "./attributes/attribute-set-admin.service.js";
import { ProductAttributeSetController } from "./attributes/product-attribute-set.controller.js";
import { ProductKnowledgeService } from "./knowledge/knowledge.service.js";
import { ProductController } from "./product.controller.js";
import { ProductRepository } from "./product.repository.js";
import { PRODUCT_ENVIRONMENT, ProductService } from "./product.service.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";

import { CategoryRedirectBackfillController } from "./redirect/category-redirect-backfill.controller.js";
import {
  CATEGORY_BACKFILL_DB,
  CategoryRedirectBackfillService,
} from "./redirect/category-redirect-backfill.service.js";
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
import { DoseEffectsController } from "./dose-effects/dose-effects.controller.js";
import { DoseEffectsService } from "./dose-effects/dose-effects.service.js";
import { ManufacturerClaimsController } from "./manufacturer-claims/manufacturer-claims.controller.js";
import { ManufacturerClaimsService } from "./manufacturer-claims/manufacturer-claims.service.js";
import { DoseProjectionService } from "./dose-effects/dose-projection.service.js";
import { CustomerCandidateSource } from "../aquariums/recommendation/customer-candidate-source.js";
@Module({
  controllers: [
    ProductController,
    DoseEffectsController,
    ManufacturerClaimsController,
    ProductBarcodeController,
    ProductExtensionController,
    ProductShippingProfileController,
    ProductHusbandryController,
    ProductShippingProfileBulkController,
    ShippingProfileFillController,
    CatalogOptionsController,
    ProductEnrichmentReviewController,
    ProductEnrichmentQueueController,
    ProductEnrichmentRunsController,
    ProductKnowledgeController,
    AttributeController,
    ProductAttributeSetController,
    WebshopSlugController,
    UrlRedirectController,
    CategoryRedirectBackfillController,
  ],
  providers: [
    AttributeSetAdminService,
    DoseEffectsService,
    ManufacturerClaimsService,
    DoseProjectionService,
    // the dose projection also rebuilds the customer candidates (V3.4 S2b); the source has no dependencies of its own
    CustomerCandidateSource,
    ProductRepository,
    ProductService,
    { provide: PRODUCT_ENVIRONMENT, useValue: process.env },
    documentStoreProvider,
    ProductBarcodeRepository,
    ProductBarcodeService,
    ProductExtensionRepository,
    ProductShippingProfileRepository,
    ProductHusbandryRepository,
    ProductHusbandryService,
    ShippingProfileFillRepository,
    ShippingProfileFillService,
    ProductShippingProfileService,
    ProductExtensionService,
    ProductEnrichmentReviewService,
    { provide: ENRICHMENT_READER, useClass: PrismaEnrichmentReader },
    { provide: ENRICHMENT_RUNS_READER, useClass: PrismaEnrichmentRunsReader },
    ProductKnowledgeService,
    { provide: KNOWLEDGE_STORE, useClass: PrismaKnowledgeStore },
    WebshopSlugService,
    { provide: WEBSHOP_SLUG_STORE, useClass: PrismaWebshopSlugStore },
    UrlRedirectService,
    { provide: REDIRECT_TRANSACTOR, useValue: prismaRedirectTransactor },
    CategoryRedirectBackfillService,
    { provide: CATEGORY_BACKFILL_DB, useValue: prisma },
  ],
  exports: [
    ProductService,
    ProductExtensionService,
    ProductBarcodeRepository,
    DoseProjectionService,
  ],
})
export class ProductModule {}
