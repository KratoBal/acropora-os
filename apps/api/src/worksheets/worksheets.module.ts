import { Module } from "@nestjs/common";

import { WorksheetsController } from "./worksheets.controller.js";
import { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

@Module({
  controllers: [WorksheetsController],
  providers: [WorksheetsRepository, WorksheetsService],
  exports: [WorksheetsRepository, WorksheetsService],
})
export class WorksheetsModule {}
