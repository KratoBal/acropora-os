import { Type } from "class-transformer";
import { IsInt, Max, Min, ValidateIf } from "class-validator";

import { CONTENT_CALENDAR_SETTING_LIMITS } from "@acropora/types";

const L = CONTENT_CALENDAR_SETTING_LIMITS.newsletterMinDays;

/** `null` clears the setting: the newsletter rule then says nothing again. */
export class ContentCalendarSettingsDto {
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  newsletterMinDays!: number | null;
}
