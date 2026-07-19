import { Module } from "@nestjs/common";
import { BrandsController } from "./brands.controller.js";
import { BrandsRepository } from "./brands.repository.js";
import { BrandsService } from "./brands.service.js";
import { BrandImportAssistantController } from "./brand-import-assistant.controller.js";
import { BrandImportAssistantService } from "./brand-import-assistant.service.js";

@Module({
  controllers: [BrandImportAssistantController, BrandsController],
  providers: [BrandImportAssistantService, BrandsRepository, BrandsService],
  exports: [BrandsRepository],
})
export class BrandsModule {}
