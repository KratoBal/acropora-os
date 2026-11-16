import { Module } from "@nestjs/common";

import { ProductModule } from "../products/product.module.js";
import { ManualListController } from "./customer-candidates-manual.controller.js";
import { PrismaManualListStore } from "./customer-candidates-manual.repository.js";
import { ManualListService } from "./customer-candidates-manual.service.js";

@Module({
  imports: [ProductModule],
  controllers: [ManualListController],
  providers: [PrismaManualListStore, ManualListService],
})
export class CustomerCandidatesModule {}
