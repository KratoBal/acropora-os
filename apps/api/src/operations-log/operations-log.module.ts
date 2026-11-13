import { Module } from "@nestjs/common";

import { OperationsLogEntriesController } from "./operations-log-entries.controller.js";
import { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import { OperationsLogController } from "./operations-log.controller.js";
import { OperationsLogRepository } from "./operations-log.repository.js";
import { OperationsLogService } from "./operations-log.service.js";

/** Az üzemeltetési napló (task os-uzemeltetesi-naplo): S1 a feladat-sablonok, S2a a bejegyzések. */
@Module({
  controllers: [OperationsLogController, OperationsLogEntriesController],
  providers: [
    OperationsLogRepository,
    OperationsLogService,
    OperationsLogEntriesRepository,
    OperationsLogEntriesService,
  ],
  exports: [OperationsLogRepository],
})
export class OperationsLogModule {}
