import { Module } from "@nestjs/common";

import { ManualListController } from "./customer-candidates-manual.controller.js";
import { PrismaManualListStore } from "./customer-candidates-manual.repository.js";
import { ManualListService } from "./customer-candidates-manual.service.js";

@Module({
  controllers: [ManualListController],
  providers: [PrismaManualListStore, ManualListService],
})
export class CustomerCandidatesModule {}
