import { Module } from "@nestjs/common";

import { ServiceTokenGuard } from "./service-token.guard.js";
import { ServiceTokenRepository } from "./service-token.repository.js";
import { ServiceWorkController } from "./service-work.controller.js";
import { ServiceWorkRepository } from "./service-work.repository.js";
import { ServiceWorkService } from "./service-work.service.js";
import { TaskIngestController } from "./task-ingest.controller.js";
import { TaskIngestRepository } from "./task-ingest.repository.js";
import { TaskIngestService } from "./task-ingest.service.js";
import { TasksController } from "./tasks.controller.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

@Module({
  controllers: [TaskIngestController, TasksController, ServiceWorkController],
  providers: [
    ServiceTokenGuard,
    ServiceTokenRepository,
    ServiceWorkRepository,
    ServiceWorkService,
    TaskIngestRepository,
    TaskIngestService,
    TasksRepository,
    TasksService,
  ],
  exports: [TasksRepository],
})
export class TasksModule {}
