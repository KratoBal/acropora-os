import { Type } from "class-transformer";
import { IsInt, Matches, Max, Min, ValidateIf } from "class-validator";

import { CONTENT_RESULT_LIMITS } from "@acropora/types";

const L = CONTENT_RESULT_LIMITS.value;
const MONTH = /^\d{4}-\d{2}$/;

/**
 * One week's numbers; `null` is "not entered", never 0. THE SAVE REPLACES THE WHOLE WEEK: a key missing from the request is
 * written as null too, so a number stored earlier is cleared by leaving it out (barracuda, #2611). The web form always
 * sends all six; a caller that means to change one number sends the others as they are.
 */
export class ContentResultWeekDto {
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  reach?: number | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  reactions?: number | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  opens?: number | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  clicks?: number | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  preorders?: number | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(L.min)
  @Max(L.max)
  orders?: number | null;
}

/** Two months, both included. */
export class ContentResultsSummaryQueryDto {
  @Matches(MONTH) from!: string;
  @Matches(MONTH) to!: string;
}
