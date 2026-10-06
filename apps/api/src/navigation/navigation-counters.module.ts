import { Module } from "@nestjs/common";

import { MaterialRequestsModule } from "../material-requests/material-requests.module.js";
import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";
import { NavigationCountersController } from "./navigation-counters.controller.js";

@Module({
  imports: [ServiceJobsModule, WorksheetsModule, MaterialRequestsModule],
  controllers: [NavigationCountersController],
})
export class NavigationCountersModule {}
