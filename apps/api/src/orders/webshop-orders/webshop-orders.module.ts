import { Module } from "@nestjs/common";

import { MedusaModule } from "../../integrations/medusa/medusa.module.js";
import { WebshopOrdersController } from "./webshop-orders.controller.js";
import { WebshopOrdersRepository } from "./webshop-orders.repository.js";
import { WebshopOrdersService } from "./webshop-orders.service.js";

@Module({
  imports: [MedusaModule],
  controllers: [WebshopOrdersController],
  providers: [WebshopOrdersService, WebshopOrdersRepository],
})
export class WebshopOrdersModule {}
