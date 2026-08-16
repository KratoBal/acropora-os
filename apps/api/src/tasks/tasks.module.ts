import { Module } from "@nestjs/common";

import { TasksController } from "./tasks.controller.js";
import { TasksRepository } from "./tasks.repository.js";
import { TasksService } from "./tasks.service.js";

@Module({
  controllers: [TasksController],
  providers: [TasksRepository, TasksService],
  exports: [TasksRepository],
})
export class TasksModule {}
