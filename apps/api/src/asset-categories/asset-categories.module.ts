import { Module } from "@nestjs/common";

import { AssetCategoriesController } from "./asset-categories.controller.js";
import { AssetCategoriesRepository } from "./asset-categories.repository.js";
import { AssetCategoriesService } from "./asset-categories.service.js";

@Module({
  controllers: [AssetCategoriesController],
  providers: [AssetCategoriesRepository, AssetCategoriesService],
  exports: [AssetCategoriesRepository],
})
export class AssetCategoriesModule {}
