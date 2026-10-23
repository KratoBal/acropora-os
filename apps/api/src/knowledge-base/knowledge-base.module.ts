import { Module } from "@nestjs/common";

import { KnowledgeDiscoveryController } from "./discovery/discovery-run.controller.js";
import { KnowledgeDiscoveryService } from "./discovery/discovery-run.service.js";
import { SourceScreeningController } from "./sources/source-screening.controller.js";
import { SourceScreeningService } from "./sources/source-screening.service.js";

/** The research knowledge base (Research & Knowledge Engine, stage pilot). */
@Module({
  controllers: [KnowledgeDiscoveryController, SourceScreeningController],
  providers: [KnowledgeDiscoveryService, SourceScreeningService],
})
export class KnowledgeBaseModule {}
