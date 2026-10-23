import { Module } from "@nestjs/common";

import { KnowledgeDiscoveryController } from "./discovery/discovery-run.controller.js";
import { KnowledgeDiscoveryService } from "./discovery/discovery-run.service.js";

/** The research knowledge base (Research & Knowledge Engine, stage pilot). */
@Module({
  controllers: [KnowledgeDiscoveryController],
  providers: [KnowledgeDiscoveryService],
})
export class KnowledgeBaseModule {}
