import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Put,
  Query,
  StreamableFile,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { AttendanceService } from "./attendance.service.js";
import {
  AttendanceDayRangeQueryDto,
  AttendanceSheetQueryDto,
  SaveAttendanceDayDto,
  SaveAttendanceScheduleDto,
} from "./dto/attendance.dto.js";

/**
 * AN EMPLOYEE'S ATTENDANCE INPUTS, kept by an admin (os-jelenleti-iv, S1): the weekly schedule versions and the days that
 * differ from them. Every route under `attendance.manage` (OWNER, ADMIN, grantable one by one), not `users.manage`: keeping
 * the sheets is an HR job, not account administration. The employee's own advance marks (S3) get their own routes.
 *
 * Each route carries the right itself (not the class), so `route-permission-coverage.spec.ts` sees it.
 *
 * Dates are path segments ("2026-11-13"): a schedule version is named by its first day, a day entry by its day.
 */
@Controller("attendance/users/:userId")
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Get("schedules")
  schedules(@Param("userId") userId: string) {
    return this.service.schedules(userId);
  }

  /** Creates or replaces the version starting on `validFrom`; the earlier versions, and so the earlier months, stay. */
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Put("schedules/:validFrom")
  saveSchedule(
    @Param("userId") userId: string,
    @Param("validFrom") validFrom: string,
    @Body() input: SaveAttendanceScheduleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveSchedule(userId, validFrom, input.days, user.id);
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Delete("schedules/:validFrom")
  @HttpCode(204)
  deleteSchedule(
    @Param("userId") userId: string,
    @Param("validFrom") validFrom: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteSchedule(userId, validFrom, user.id);
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Get("days")
  days(
    @Param("userId") userId: string,
    @Query() query: AttendanceDayRangeQueryDto,
  ) {
    return this.service.days(userId, query.from, query.to);
  }

  /** The month's sheet ("2026-11"), computed: the screen and the PDF print it (S2). */
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Get("sheet")
  sheet(
    @Param("userId") userId: string,
    @Query() query: AttendanceSheetQueryDto,
  ) {
    return this.service.sheet(userId, query.month);
  }

  /** The month's sheet as a PDF, inline: printed and signed at month end, downloadable any time (S2c). */
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Get("sheet.pdf")
  @Header("Cache-Control", "private, no-store")
  async sheetPdf(
    @Param("userId") userId: string,
    @Query() query: AttendanceSheetQueryDto,
  ) {
    const document = await this.service.sheetPdf(
      userId,
      query.month,
      new Date(),
    );
    return new StreamableFile(document.bytes, {
      type: "application/pdf",
      length: document.bytes.length,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Put("days/:date")
  saveDay(
    @Param("userId") userId: string,
    @Param("date") date: string,
    @Body() input: SaveAttendanceDayDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.saveDay(userId, date, input, user.id);
  }

  /** The day follows the schedule again. */
  @RequirePermissions(PERMISSIONS.ATTENDANCE_MANAGE)
  @Delete("days/:date")
  @HttpCode(204)
  deleteDay(
    @Param("userId") userId: string,
    @Param("date") date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.deleteDay(userId, date, user.id);
  }
}
