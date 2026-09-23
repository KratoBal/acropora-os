import { Module } from "@nestjs/common";

import { AssetFunctionsController } from "./asset-functions.controller.js";
import { AssetFunctionsRepository } from "./asset-functions.repository.js";
import { AssetFunctionsService } from "./asset-functions.service.js";

@Module({
  controllers: [AssetFunctionsController],
  providers: [AssetFunctionsRepository, AssetFunctionsService],
  exports: [AssetFunctionsRepository],
})
export class AssetFunctionsModule {}
