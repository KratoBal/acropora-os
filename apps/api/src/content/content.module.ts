import { Module } from "@nestjs/common";

import { ContentController } from "./content.controller.js";
import { ContentRepository } from "./content.repository.js";
import { ContentService } from "./content.service.js";

@Module({
  controllers: [ContentController],
  providers: [ContentRepository, ContentService],
  exports: [ContentService],
})
export class ContentModule {}
