import { Controller, Get } from "@nestjs/common";
import { PERMISSIONS } from "@acropora/types";

import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AttendanceService } from "./attendance.service.js";

/**
 * WHO HAS A SHEET (os-jelenleti-iv, S2b): the attendance page's employee picker. Under `attendance.manage` and not the
 * user list's `users.manage`, so the right works on its own.
 */
@Controller("attendance")
export class AttendanceEmployeesController {
  constructor(private readonly service: AttendanceService) {}

  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Get("employees")
  employees() {
    return this.service.employees();
  }
}
