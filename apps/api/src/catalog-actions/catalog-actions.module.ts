import { Module } from "@nestjs/common";

import { CatalogActionsController } from "./catalog-actions.controller.js";
import { CatalogActionsService } from "./catalog-actions.service.js";

@Module({
  controllers: [CatalogActionsController],
  providers: [CatalogActionsService],
})
export class CatalogActionsModule {}
