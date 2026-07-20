import { Module } from "@nestjs/common";

import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportController } from "./unas-import.controller.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasApplyRepository } from "./unas-apply.repository.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasBrandReviewRepository } from "./unas-brand-review.repository.js";
import { UnasBrandReviewService } from "./unas-brand-review.service.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";
import { UnasApiClient } from "./unas-api.client.js";
import { UnasAuthService } from "./unas-auth.service.js";
import { UnasProductCanonicalizer } from "./unas-product-canonicalizer.js";
import { UnasProductSyncDiffEngine } from "./unas-product-sync-diff.engine.js";
import { UnasProductSyncRepository } from "./unas-product-sync.repository.js";
import { UnasProductSyncScheduler } from "./unas-product-sync.scheduler.js";
import { UnasProductSyncService } from "./unas-product-sync.service.js";
import { UnasProductSyncController } from "./unas-product-sync.controller.js";
import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";

@Module({
  controllers: [UnasImportController, UnasProductSyncController],
  providers: [
    UnasXlsxParser,
    UnasApiClient,
    UnasAuthService,
    UnasProductCanonicalizer,
    UnasProductSyncDiffEngine,
    UnasProductSyncRepository,
    UnasProductSyncScheduler,
    UnasProductSyncService,
    UnasImportValidator,
    UnasDiffEngine,
    UnasImportRepository,
    UnasImportService,
    BrandResolutionEngine,
    UnasApplyRepository,
    UnasApplyService,
    UnasBrandReviewRepository,
    UnasBrandReviewService,
  ],
})
export class UnasImportModule {}
