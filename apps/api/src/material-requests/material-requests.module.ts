import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";
import { MaterialRequestsController } from "./material-requests.controller.js";
import { MaterialRequestsRepository } from "./material-requests.repository.js";
import { MaterialRequestsService } from "./material-requests.service.js";

@Module({
  imports: [NotificationsModule, WorksheetsModule],
  controllers: [MaterialRequestsController],
  providers: [MaterialRequestsRepository, MaterialRequestsService],
  exports: [MaterialRequestsService],
})
export class MaterialRequestsModule {}
