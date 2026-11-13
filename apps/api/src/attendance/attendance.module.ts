import { Module } from "@nestjs/common";

import { AttendanceController } from "./attendance.controller.js";
import { AttendanceRepository } from "./attendance.repository.js";
import { AttendanceService } from "./attendance.service.js";

/** The attendance sheet (task os-jelenleti-iv). */
@Module({
  controllers: [AttendanceController],
  providers: [AttendanceRepository, AttendanceService],
})
export class AttendanceModule {}
