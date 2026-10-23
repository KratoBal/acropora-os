import { Module } from "@nestjs/common";

import { KnowledgeDiscoveryController } from "./discovery/discovery-run.controller.js";
import { KnowledgeDiscoveryService } from "./discovery/discovery-run.service.js";
import { KnowledgeExtractionController } from "./extraction/extraction.controller.js";
import { KnowledgeExtractionService } from "./extraction/extraction.service.js";

/** The research knowledge base (Research & Knowledge Engine, stage pilot). */
@Module({
  controllers: [KnowledgeDiscoveryController, KnowledgeExtractionController],
  providers: [KnowledgeDiscoveryService, KnowledgeExtractionService],
})
export class KnowledgeBaseModule {}
