import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

/**
 * The product dose list's bodies (ReefClub plan v6.1, 6.2; slice 7). The
 * parameter codes are the measurement catalog's, the directions the JEV's.
 * The numbers are positive (the database says the same); the ceilings are
 * there to refuse a unit slip (litres for millilitres), not to judge the
 * product.
 */
const PARAMETER_CODES = AQUARIUM_MEASUREMENT_PARAMETERS.map(
  (parameter) => parameter.code,
);
const DIRECTIONS = ["EMEL", "CSOKKENT"] as const;
const DOSE_UNITS = ["ML", "G", "CSEPP"] as const;
const NUMBER_MAX = 1_000_000;
const SOURCE_MAX = 500;
/** A month: a longer effect time is not a dosing product. */
const EFFECT_HOURS_MAX = 720;

export class CreateDoseEffectDto {
  @IsIn(PARAMETER_CODES) parameterCode!: string;
  @IsIn(DIRECTIONS) direction!: (typeof DIRECTIONS)[number];

  /** How much one dose unit changes the parameter in 100 litres, in the parameter's unit. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  effectPer100L!: number;

  @IsIn(DOSE_UNITS) doseUnit!: (typeof DOSE_UNITS)[number];

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  doseStep!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  maxDailyDosePer100L?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EFFECT_HOURS_MAX)
  effectHours?: number;

  /** The manufacturer's page or the label. */
  @IsString()
  @Matches(/\S/, { message: "A forrás kötelező." })
  @MaxLength(SOURCE_MAX)
  source!: string;
}

/**
 * An edit of the current version: any field may change except the product,
 * the parameter and the direction (those make a different row). `null`
 * clears the daily maximum or the effect time. `expectedVersion` is the
 * version the editor saw.
 */
export class UpdateDoseEffectDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  effectPer100L?: number;

  @IsOptional() @IsIn(DOSE_UNITS) doseUnit?: (typeof DOSE_UNITS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  doseStep?: number;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  maxDailyDosePer100L?: number | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EFFECT_HOURS_MAX)
  effectHours?: number | null;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "A forrás nem lehet üres." })
  @MaxLength(SOURCE_MAX)
  source?: string;
}

/** The check of the version the checker saw. */
export class VerifyDoseEffectDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
}

export class DoseEffectListQueryDto {
  @IsOptional() @IsIn(PARAMETER_CODES) parameterCode?: string;

  /** "true" or "false" (a query string; `Boolean("false")` would be true). */
  @IsOptional()
  @IsIn(["true", "false"])
  includeArchived?: "true" | "false";
}
