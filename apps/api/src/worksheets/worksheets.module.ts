import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { WorksheetsController } from "./worksheets.controller.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

@Module({
  imports: [NotificationsModule],
  controllers: [WorksheetsController],
  providers: [WorksheetsRepository, WorksheetsService],
  exports: [WorksheetsRepository, WorksheetsService],
})
export class WorksheetsModule {}
