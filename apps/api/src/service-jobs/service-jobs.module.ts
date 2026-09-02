import { Module } from "@nestjs/common";

import { ServiceJobsController } from "./service-jobs.controller.js";
import { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

@Module({
  controllers: [ServiceJobsController],
  providers: [ServiceJobsRepository, ServiceJobsService],
  exports: [ServiceJobsRepository, ServiceJobsService],
})
export class ServiceJobsModule {}
