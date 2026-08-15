import { Module } from "@nestjs/common";

import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

@Module({
  controllers: [ServiceAssetsController],
  providers: [ServiceAssetsRepository, ServiceAssetsService],
  exports: [ServiceAssetsRepository, ServiceAssetsService],
})
export class ServiceAssetsModule {}
