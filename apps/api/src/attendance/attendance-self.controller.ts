import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
} from "@nestjs/common";
import type { AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { AttendanceService } from "./attendance.service.js";
import {
  AttendanceSheetQueryDto,
  SaveOwnAttendanceDayDto,
} from "./dto/attendance.dto.js";

/**
 * THE EMPLOYEE'S OWN SHEET (os-jelenleti-iv, S3; brief point 3): read it, and mark leave or a day off in advance. No right
 * is asked, like the account's own settings: every route acts on the signed-in user only, and the service refuses a
 * partner or machine account (no sheet), a past or today's day, another kind, and a day an admin marked otherwise.
 */
@Controller("attendance/me")
export class AttendanceSelfController {
  constructor(private readonly service: AttendanceService) {}

  @Get("sheet")
  sheet(
    @Query() query: AttendanceSheetQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.sheet(user.id, query.month);
  }

  @Put("days/:date")
  markDay(
    @Param("date") date: string,
    @Body() input: SaveOwnAttendanceDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markOwnDay(user.id, date, input.kind, new Date());
  }

  @Delete("days/:date")
  @HttpCode(204)
  clearDay(
    @Param("date") date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.clearOwnDay(user.id, date, new Date());
  }
}
