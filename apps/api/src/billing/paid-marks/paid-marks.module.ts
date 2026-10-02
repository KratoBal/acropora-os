import { Module } from "@nestjs/common";

import { SzamlazzModule } from "../../integrations/szamlazz/szamlazz.module.js";
import { PaidMarkRunRepository } from "./paid-mark-run.repository.js";
import { PaidMarksAutoScheduler } from "./paid-marks-auto.scheduler.js";
import { PaidMarksController } from "./paid-marks.controller.js";

/** The daily automatic paid marks (GLS, Foxpost, SimplePay; acrobot 26101). */
@Module({
  imports: [SzamlazzModule],
  controllers: [PaidMarksController],
  providers: [PaidMarkRunRepository, PaidMarksAutoScheduler],
})
export class PaidMarksModule {}
