import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

import { CALENDAR_EVENT_KINDS, CALENDAR_EVENT_LIMITS } from "@acropora/types";

/** A day as `YYYY-MM-DD`. The shape only; whether it is a real day, and the order of the two, is the service's check. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = "A dátum ÉÉÉÉ-HH-NN alakú legyen.";

/** A missing `endsOn` is a one-day event. */
export class CreateCalendarEventDto {
  @IsIn(CALENDAR_EVENT_KINDS)
  kind!: (typeof CALENDAR_EVENT_KINDS)[number];
  @IsString()
  @MinLength(CALENDAR_EVENT_LIMITS.title.min)
  @MaxLength(CALENDAR_EVENT_LIMITS.title.max)
  title!: string;
  @Matches(DAY, { message: DAY_MESSAGE }) startsOn!: string;
  @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) endsOn?: string;
  @IsOptional()
  @IsString()
  @MaxLength(CALENDAR_EVENT_LIMITS.location.max)
  location?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) responsibleUserId?:
    string | null;
}

/**
 * EVERY FIELD OPTIONAL, AND `null` CLEARS the two that may be empty (`location`, `responsibleUserId`): an absent key
 * means "leave it". `ValidateIf` lets a null through the string checks.
 */
export class UpdateCalendarEventDto {
  /** The `updatedAt` of the record the form was loaded from: a record changed since is refused (409), not overwritten. */
  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(CALENDAR_EVENT_KINDS)
  kind?: (typeof CALENDAR_EVENT_KINDS)[number];
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(CALENDAR_EVENT_LIMITS.title.min)
  @MaxLength(CALENDAR_EVENT_LIMITS.title.max)
  title?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(DAY, { message: DAY_MESSAGE })
  startsOn?: string;
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(DAY, { message: DAY_MESSAGE })
  endsOn?: string;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(CALENDAR_EVENT_LIMITS.location.max)
  location?: string | null;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  responsibleUserId?: string | null;
}
