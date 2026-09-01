import { Module } from "@nestjs/common";

import { documentStoreProvider } from "./document-store/document-store.provider.js";
import { ServiceAssetsController } from "./service-assets.controller.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

@Module({
  controllers: [ServiceAssetsController],
  providers: [
    documentStoreProvider,
    ServiceAssetsRepository,
    ServiceAssetsService,
  ],
  exports: [ServiceAssetsRepository, ServiceAssetsService],
})
export class ServiceAssetsModule {}
