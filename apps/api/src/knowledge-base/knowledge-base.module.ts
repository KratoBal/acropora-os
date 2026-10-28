import { Module } from "@nestjs/common";

import {
  KnowledgeAnswerController,
  KnowledgeAnswerService,
} from "./answers/knowledge-answer.controller.js";
import {
  ArticleCitationController,
  ArticleCitationService,
} from "./articles/article-citation.controller.js";

import { ClaimReviewController } from "./claims/claim-review.controller.js";
import { ClaimReviewService } from "./claims/claim-review.service.js";
import {
  ClaimStoreController,
  ClaimStoreService,
} from "./claims/claim-store.controller.js";
import { KnowledgeDiscoveryController } from "./discovery/discovery-run.controller.js";
import { KnowledgeDiscoveryService } from "./discovery/discovery-run.service.js";
import { KnowledgeExtractionController } from "./extraction/extraction.controller.js";
import {
  GoldSetController,
  GoldSetService,
} from "./gold-set/gold-set.controller.js";
import { KnowledgeExtractionService } from "./extraction/extraction.service.js";
import {
  ConclusionController,
  ConclusionService,
} from "./conclusions/conclusion.controller.js";
import {
  KnowledgeOverviewController,
  KnowledgeOverviewService,
} from "./overview/knowledge-overview.controller.js";
import {
  KnowledgeReferenceController,
  KnowledgeReferenceService,
} from "./references/reference-check.controller.js";
import {
  ResearchDraftController,
  ResearchDraftService,
} from "./research-drafts/research-draft.controller.js";
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
    ConclusionController,
    ArticleCitationController,
    KnowledgeAnswerController,
    ResearchDraftController,
    KnowledgeReferenceController,
    GoldSetController,
  ],
  providers: [
    KnowledgeDiscoveryService,
    KnowledgeExtractionService,
    SourceScreeningService,
    KnowledgeOverviewService,
    ClaimReviewService,
    ClaimStoreService,
    VocabularyService,
    ConclusionService,
    ArticleCitationService,
    KnowledgeAnswerService,
    ResearchDraftService,
    KnowledgeReferenceService,
    GoldSetService,
  ],
})
export class KnowledgeBaseModule {}
