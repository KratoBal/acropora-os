import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

import {
  CLAIM_SOURCE_KINDS,
  CLAIM_STATUSES,
  CLAIM_TYPES,
  type ClaimSourceKind,
  type ClaimStatus,
  type ClaimType,
} from "./manufacturer-claim.rules.js";

/**
 * The manufacturer claim bodies (T5.3, spec point 1). Dates are calendar days (`YYYY-MM-DD`): the
 * manufacturer's publication date and the day we read it. The amount ceiling is there to refuse a
 * unit slip, not to judge the product.
 */
const TEXT_MAX = 4000;
const SOURCE_REF_MAX = 1000;
const NOTE_MAX = 1000;
const UNIT_MAX = 32;
const NUMBER_MAX = 1_000_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = "A dátum alakja ÉÉÉÉ-HH-NN.";

export class CreateManufacturerClaimDto {
  @IsIn(CLAIM_TYPES) claimType!: ClaimType;

  /** As the source states it, close to the manufacturer's wording. */
  @IsString()
  @Matches(/\S/, { message: "Az állítás szövege kötelező." })
  @MaxLength(TEXT_MAX)
  claimText!: string;

  @IsIn(CLAIM_SOURCE_KINDS) sourceKind!: ClaimSourceKind;

  /** A web address or a file path. */
  @IsString()
  @Matches(/\S/, { message: "A forrás kötelező." })
  @MaxLength(SOURCE_REF_MAX)
  sourceRef!: string;

  /** When the manufacturer published it; left out when the source is not dated. */
  @IsOptional()
  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  sourcePublishedOn?: string;

  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  sourceReadOn!: string;

  /** A machine-readable number (e.g. a dose) with its unit; the two go together. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  valueAmount?: number;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "A mértékegység nem lehet üres." })
  @MaxLength(UNIT_MAX)
  valueUnit?: string;

  @IsOptional() @IsString() @MaxLength(NOTE_MAX) note?: string;

  @IsOptional()
  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  recheckOn?: string;

  /** Dosing claims only: the product's accepted Product Knowledge dosing fact it stands on. */
  @IsOptional() @IsString() @MaxLength(64) knowledgeFactId?: string;
}

/**
 * An edit of the current version: any field but the product. `null` clears an optional one.
 * `expectedVersion` is the version the editor saw. Naming the same `knowledgeFactId` again
 * re-reads the fact's revision (after the fact changed).
 */
export class UpdateManufacturerClaimDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional() @IsIn(CLAIM_TYPES) claimType?: ClaimType;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Az állítás szövege nem lehet üres." })
  @MaxLength(TEXT_MAX)
  claimText?: string;

  @IsOptional() @IsIn(CLAIM_SOURCE_KINDS) sourceKind?: ClaimSourceKind;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "A forrás nem lehet üres." })
  @MaxLength(SOURCE_REF_MAX)
  sourceRef?: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  sourcePublishedOn?: string | null;

  @IsOptional()
  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  sourceReadOn?: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  @Max(NUMBER_MAX)
  valueAmount?: number | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/\S/, { message: "A mértékegység nem lehet üres." })
  @MaxLength(UNIT_MAX)
  valueUnit?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Matches(DAY, { message: DAY_MESSAGE })
  @IsISO8601({ strict: true }, { message: DAY_MESSAGE })
  recheckOn?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(64)
  knowledgeFactId?: string | null;
}

/** A check state for the version the checker saw. */
export class SetManufacturerClaimStatusDto {
  @Type(() => Number) @IsInt() @Min(1) expectedVersion!: number;
  @IsIn(CLAIM_STATUSES) status!: ClaimStatus;
}

export class ManufacturerClaimListQueryDto {
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: ClaimStatus;
  @IsOptional() @IsIn(CLAIM_TYPES) claimType?: ClaimType;
  @IsOptional() @IsString() @MaxLength(64) productId?: string;

  /** "true" or "false" (a query string; `Boolean("false")` would be true). */
  @IsOptional()
  @IsIn(["true", "false"])
  includeArchived?: "true" | "false";
}
