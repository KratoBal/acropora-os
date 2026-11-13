import { Module } from "@nestjs/common";

import { OperationsLogController } from "./operations-log.controller.js";
import { OperationsLogRepository } from "./operations-log.repository.js";
import { OperationsLogService } from "./operations-log.service.js";

/** Az üzemeltetési napló (task os-uzemeltetesi-naplo): S1 a feladat-sablonok. */
@Module({
  controllers: [OperationsLogController],
  providers: [OperationsLogRepository, OperationsLogService],
  exports: [OperationsLogRepository],
})
export class OperationsLogModule {}
