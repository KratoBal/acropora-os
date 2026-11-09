import { Module } from "@nestjs/common";

import { LivestockArrivalsController } from "./livestock-arrivals.controller.js";
import { LivestockArrivalsRepository } from "./livestock-arrivals.repository.js";
import { LivestockArrivalsService } from "./livestock-arrivals.service.js";

@Module({
  controllers: [LivestockArrivalsController],
  providers: [LivestockArrivalsRepository, LivestockArrivalsService],
})
export class LivestockArrivalsModule {}
