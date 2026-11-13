import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

import { ATTENDANCE_DAY_KINDS, type AttendanceDayKind } from "@acropora/types";

/*
  THE SHAPE ONLY. Whether a time is a time of day, a departure after the arrival, a weekday in 1..7 and once, a mark without
  times: the shared checks in `@acropora/types` decide that in the service, so the screen and the API refuse with the same
  sentence.
*/
export class AttendanceScheduleDayDto {
  @IsInt() weekday!: number;
  @IsString() start!: string;
  @IsString() end!: string;
}

export class SaveAttendanceScheduleDto {
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => AttendanceScheduleDayDto)
  days!: AttendanceScheduleDayDto[];
}

export class SaveAttendanceDayDto {
  @IsIn(ATTENDANCE_DAY_KINDS) kind!: AttendanceDayKind;
  @IsOptional() @IsString() start?: string | null;
  @IsOptional() @IsString() end?: string | null;
}

export class AttendanceDayRangeQueryDto {
  @IsString() from!: string;
  @IsString() to!: string;
}

export class AttendanceSheetQueryDto {
  @IsString() month!: string;
}
