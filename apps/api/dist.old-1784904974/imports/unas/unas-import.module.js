var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
import { UnasConnectionController } from "./unas-connection.controller.js";
import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionService } from "./unas-connection.service.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";
import { UnasConnectionStartupValidator } from "./unas-connection-startup.validator.js";
import { UnasClock } from "./unas-login-expiry.js";
let UnasImportModule = class UnasImportModule {
};
UnasImportModule = __decorate([
    Module({
        controllers: [
            UnasImportController,
            UnasProductSyncController,
            UnasConnectionController,
        ],
        providers: [
            UnasXlsxParser,
            UnasApiClient,
            UnasAuthService,
            UnasConnectionRepository,
            UnasConnectionService,
            UnasConnectionStartupValidator,
            UnasCredentialCryptoService,
            UnasCredentialProvider,
            UnasClock,
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
        exports: [UnasApiClient, UnasAuthService],
    })
], UnasImportModule);
export { UnasImportModule };
//# sourceMappingURL=unas-import.module.js.map