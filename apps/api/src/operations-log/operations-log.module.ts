import { Module } from "@nestjs/common";

import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { OperationsLogEntriesController } from "./operations-log-entries.controller.js";
import { OperationsLogEntriesRepository } from "./operations-log-entries.repository.js";
import { OperationsLogEntriesService } from "./operations-log-entries.service.js";
import { OperationsLogPhotosService } from "./operations-log-photos.service.js";
import { OperationsLogController } from "./operations-log.controller.js";
import { OperationsLogRepository } from "./operations-log.repository.js";
import { OperationsLogService } from "./operations-log.service.js";

/** Az üzemeltetési napló (task os-uzemeltetesi-naplo): S1 a feladat-sablonok, S2a a bejegyzések, S2b a fénykép mezők képei. */
@Module({
  // az üzemeltetési napló rendellenességéből nyílik a hibajegy (S3)
  imports: [ServiceJobsModule],
  controllers: [OperationsLogController, OperationsLogEntriesController],
  providers: [
    documentStoreProvider,
    OperationsLogRepository,
    OperationsLogService,
    OperationsLogEntriesRepository,
    OperationsLogEntriesService,
    OperationsLogPhotosService,
  ],
  exports: [OperationsLogRepository],
})
export class OperationsLogModule {}
