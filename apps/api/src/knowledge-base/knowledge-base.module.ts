import { Module } from "@nestjs/common";

import { ClaimReviewController } from "./claims/claim-review.controller.js";
import { ClaimReviewService } from "./claims/claim-review.service.js";
import {
  ClaimStoreController,
  ClaimStoreService,
} from "./claims/claim-store.controller.js";
import { KnowledgeDiscoveryController } from "./discovery/discovery-run.controller.js";
import { KnowledgeDiscoveryService } from "./discovery/discovery-run.service.js";
import { KnowledgeExtractionController } from "./extraction/extraction.controller.js";
import { KnowledgeExtractionService } from "./extraction/extraction.service.js";
import {
  KnowledgeOverviewController,
  KnowledgeOverviewService,
} from "./overview/knowledge-overview.controller.js";
import { SourceScreeningController } from "./sources/source-screening.controller.js";
import { SourceScreeningService } from "./sources/source-screening.service.js";
import {
  VocabularyController,
  VocabularyService,
} from "./vocabulary/vocabulary.controller.js";

/** The research knowledge base (Research & Knowledge Engine, stage pilot). */
@Module({
  controllers: [
    KnowledgeDiscoveryController,
    KnowledgeExtractionController,
    SourceScreeningController,
    KnowledgeOverviewController,
    ClaimReviewController,
    ClaimStoreController,
    VocabularyController,
  ],
  providers: [
    KnowledgeDiscoveryService,
    KnowledgeExtractionService,
    SourceScreeningService,
    KnowledgeOverviewService,
    ClaimReviewService,
    ClaimStoreService,
    VocabularyService,
  ],
})
export class KnowledgeBaseModule {}
