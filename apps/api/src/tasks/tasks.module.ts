import { Module } from "@nestjs/common";

import { ServiceTokenGuard } from "./service-token.guard.js";
import { ServiceTokenRepository } from "./service-token.repository.js";
import { TaskIngestController } from "./task-ingest.controller.js";
import { TaskIngestRepository } from "./task-ingest.repository.js";
import { TaskIngestService } from "./task-ingest.service.js";
import { TasksController } from "./tasks.controller.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

@Module({
  controllers: [TaskIngestController, TasksController],
  providers: [
    ServiceTokenGuard,
    ServiceTokenRepository,
    TaskIngestRepository,
    TaskIngestService,
    TasksRepository,
    TasksService,
  ],
  exports: [TasksRepository],
})
export class TasksModule {}
