import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import {
  LIVESTOCK_ARRIVAL_KINDS,
  LIVESTOCK_ARRIVAL_LIMITS,
  LIVESTOCK_ARRIVAL_STATUSES,
} from "@acropora/types";

import { optionalQueryBoolean } from "../../common/query-boolean.util.js";

/** A day as `YYYY-MM-DD`. The shape only; whether it is a real calendar day is the service's check. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = "A dátum ÉÉÉÉ-HH-NN alakú legyen.";

/**
 * THE LIST'S FILTERS. All optional: no filter lists everything, the soonest day first. `upcoming` hides what is already here or
 * cancelled and what lies in the past (the list a person reads on arrival day).
 */
export class LivestockArrivalListQueryDto {
  @IsOptional()
  @IsIn(LIVESTOCK_ARRIVAL_STATUSES)
  status?: (typeof LIVESTOCK_ARRIVAL_STATUSES)[number];
  @IsOptional()
  @IsIn(LIVESTOCK_ARRIVAL_KINDS)
  kind?: (typeof LIVESTOCK_ARRIVAL_KINDS)[number];
  /**
   * A QUERY-STRING BOOLEAN IS TEXT: `"false"` must stay false (`@Type(() => Boolean)` would make it true), see
   * `query-boolean.util.ts`.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
  @IsBoolean()
  preorderable?: boolean;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
  @IsBoolean()
  upcoming?: boolean;
}

export class CreateLivestockArrivalDto {
  @IsIn(LIVESTOCK_ARRIVAL_KINDS)
  kind!: (typeof LIVESTOCK_ARRIVAL_KINDS)[number];
  @IsString()
  @MinLength(LIVESTOCK_ARRIVAL_LIMITS.label.min)
  @MaxLength(LIVESTOCK_ARRIVAL_LIMITS.label.max)
  label!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) productId?:
    string | null;
  @Matches(DAY, { message: DAY_MESSAGE }) expectedOn!: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIVESTOCK_ARRIVAL_LIMITS.quantity.min)
  @Max(LIVESTOCK_ARRIVAL_LIMITS.quantity.max)
  quantity?: number | null;
  @IsOptional()
  @IsIn(LIVESTOCK_ARRIVAL_STATUSES)
  status?: (typeof LIVESTOCK_ARRIVAL_STATUSES)[number];
  @IsOptional() @IsBoolean() preorderable?: boolean;
  @IsOptional()
  @IsString()
  @MaxLength(LIVESTOCK_ARRIVAL_LIMITS.note.max)
  note?: string | null;
}

/**
 * EVERY FIELD OPTIONAL, AND `null` CLEARS the three that may be empty (`productId`, `quantity`, `note`): the form sends what
 * it holds, and an explicit null means "take the link off", where an absent key means "leave it". `ValidateIf` lets a null
 * through the string and number checks.
 */
export class UpdateLivestockArrivalDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(LIVESTOCK_ARRIVAL_KINDS)
  kind?: (typeof LIVESTOCK_ARRIVAL_KINDS)[number];
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(LIVESTOCK_ARRIVAL_LIMITS.label.min)
  @MaxLength(LIVESTOCK_ARRIVAL_LIMITS.label.max)
  label?: string;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productId?: string | null;
  @ValidateIf((_object, value) => value !== undefined)
  @Matches(DAY, { message: DAY_MESSAGE })
  expectedOn?: string;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(LIVESTOCK_ARRIVAL_LIMITS.quantity.min)
  @Max(LIVESTOCK_ARRIVAL_LIMITS.quantity.max)
  quantity?: number | null;
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(LIVESTOCK_ARRIVAL_STATUSES)
  status?: (typeof LIVESTOCK_ARRIVAL_STATUSES)[number];
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  preorderable?: boolean;
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(LIVESTOCK_ARRIVAL_LIMITS.note.max)
  note?: string | null;
}
