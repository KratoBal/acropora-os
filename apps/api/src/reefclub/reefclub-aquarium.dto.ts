import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

/**
 * The ReefClub aquarium request bodies (plan v6.1, 3.4). Real classes, so the
 * global `ValidationPipe` (`whitelist` + `forbidNonWhitelisted`) refuses an
 * unknown field instead of ignoring it: an `ownerAccountId`, a `customerId` or
 * a `departmentId` in a body is a 400, never an owner (plan 3.1, "the owner
 * never comes from the body").
 *
 * The parameter codes come from the shared catalog, as in the internal DTO.
 */
const PARAMETER_CODES = AQUARIUM_MEASUREMENT_PARAMETERS.map(
  (parameter) => parameter.code,
);
const WATER_BODY_TYPES = ["AKVARIUM", "TO"] as const;
const WATER_TYPES = ["EDESVIZI", "TENGERI"] as const;
const NAME_MAX = 100;
/** `systemVolumeLiters` is Decimal(12,3); a million litres is far above any tank. */
const VOLUME_MAX = 1_000_000;
/** The numeric columns are Decimal(19,6). */
const VALUE_LIMIT = 1e12;

export class ReefClubCreateAquariumDto {
  @IsString()
  @Matches(/\S/, { message: "A név nem lehet üres." })
  @MaxLength(NAME_MAX)
  name!: string;

  @IsOptional()
  @IsIn(WATER_BODY_TYPES)
  waterBodyType?: (typeof WATER_BODY_TYPES)[number];

  @IsOptional()
  @IsIn(WATER_TYPES)
  waterType?: (typeof WATER_TYPES)[number];

  /** The net volume in litres. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(VOLUME_MAX)
  systemVolumeLiters?: number;
}

/**
 * A missing field stays; `null` clears the optional ones. The name and the
 * water body type are required columns: for them `null` is validated (and
 * refused), not skipped as `@IsOptional` would.
 */
export class ReefClubUpdateAquariumDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/\S/, { message: "A név nem lehet üres." })
  @MaxLength(NAME_MAX)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(WATER_BODY_TYPES)
  waterBodyType?: (typeof WATER_BODY_TYPES)[number];

  @IsOptional()
  @IsIn(WATER_TYPES)
  waterType?: (typeof WATER_TYPES)[number] | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(VOLUME_MAX)
  systemVolumeLiters?: number | null;
}

/** One parameter's own range; both bounds optional, at least one given. */
export class ReefClubTargetDto {
  @IsIn(PARAMETER_CODES) parameterCode!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-VALUE_LIMIT)
  @Max(VALUE_LIMIT)
  min?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-VALUE_LIMIT)
  @Max(VALUE_LIMIT)
  max?: number;
}

/** The whole set of the aquarium's own ranges; what is not listed is removed. */
export class ReefClubSetTargetsDto {
  @IsArray()
  @ArrayMaxSize(PARAMETER_CODES.length)
  @ValidateNested({ each: true })
  @Type(() => ReefClubTargetDto)
  targets!: ReefClubTargetDto[];
}

export class ReefClubMeasurementValueDto {
  @IsIn(PARAMETER_CODES) parameterCode!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-VALUE_LIMIT)
  @Max(VALUE_LIMIT)
  value!: number;
}

/**
 * One manual measurement occasion: a moment and values, one per parameter.
 * `clientOperationId` is the same idempotency key as the internal one: a
 * repeated send returns the occasion it already created.
 */
export class ReefClubCreateMeasurementDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  clientOperationId?: string;

  /** Defaults to now; a future moment is refused (as on the internal route). */
  @IsOptional()
  @IsDateString({ strict: true })
  measuredAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PARAMETER_CODES.length)
  @ValidateNested({ each: true })
  @Type(() => ReefClubMeasurementValueDto)
  values!: ReefClubMeasurementValueDto[];
}

/**
 * Sharing an own aquarium with the shop (slice 5a): the version of the consent
 * text the user accepted, stored with the share (plan 4.4).
 */
export class ReefClubShareAquariumDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/)
  consentVersion!: string;
}

/**
 * A shop-link code as the user types it (slice 5). Only the length is bounded
 * here; the shape (alphabet, dashes, spaces) is the service's, so a malformed
 * code gets the same answer as a wrong one.
 */
export class ReefClubRedeemLinkCodeDto {
  @IsString()
  @MaxLength(40)
  code!: string;
}
