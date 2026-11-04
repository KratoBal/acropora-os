import { Module } from "@nestjs/common";

import { PartnerOrdersController } from "./partner-orders.controller.js";
import { PartnerOrdersRepository } from "./partner-orders.repository.js";
import { PartnerOrdersService } from "./partner-orders.service.js";

/** Értékesítés > Megrendelések (S1): the order list, its detail and the documents of each chain step. */
@Module({
  controllers: [PartnerOrdersController],
  providers: [PartnerOrdersRepository, PartnerOrdersService],
  exports: [PartnerOrdersService, PartnerOrdersRepository],
})
export class PartnerOrdersModule {}
