import { Type } from "class-transformer";
import { IsInt, Matches, Max, Min, ValidateIf } from "class-validator";

import { CONTENT_RESULT_LIMITS } from "@acropora/types";

const L = CONTENT_RESULT_LIMITS.value;
const MONTH = /^\d{4}-\d{2}$/;

/** One week's numbers; `null` (or a missing key) is "not entered", never 0. */
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
