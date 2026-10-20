import { Type } from "class-transformer";
import {
  IsBoolean,
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
} from "class-validator";
import { RECOMMENDATION_PARAMETERS } from "@acropora/aquarium-calc";

/**
 * The recommendation and dose request bodies (ReefClub plan v6.1, 6; slice 8,
 * endpoints). Real classes: the global `ValidationPipe` refuses an unknown
 * field. The parameter is narrowed HERE to the five the recommendation covers
 * (barracuda), so a request for any other is a 400 before it reads anything.
 */
const VALUE_LIMIT = 1e12;
const UNITS = ["ML", "G", "CSEPP"] as const;
const ANSWERS = ["GIVEN", "PARTIAL", "NOT_GIVEN"] as const;
const OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const OPERATION_ID_MESSAGE =
  "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.";

export class ReefClubRecommendDto {
  @IsIn(RECOMMENDATION_PARAMETERS) parameter!: string;
}

export class ReefClubAnswerDto {
  @IsIn(ANSWERS) answer!: (typeof ANSWERS)[number];

  /** PARTIAL only: the amount given, in the recommended unit. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(VALUE_LIMIT)
  amount?: number;

  @IsOptional()
  @IsDateString({ strict: true })
  administeredAt?: string;

  /** The customer saw that the amount differs from the recommended one; the SERVER checks whether it must. */
  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  @IsOptional()
  @Matches(OPERATION_ID, { message: OPERATION_ID_MESSAGE })
  clientOperationId?: string;
}

export class ReefClubRecordDoseDto {
  @IsIn(RECOMMENDATION_PARAMETERS) parameter!: string;

  /** Null: "another product" (an unknown effect). */
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  productId!: string | null;

  /** Null together with a null unit: the amount is not known. */
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(VALUE_LIMIT)
  amount!: number | null;

  @ValidateIf((_, value) => value !== null)
  @IsIn(UNITS)
  unit!: (typeof UNITS)[number] | null;

  @IsDateString({ strict: true }) administeredAt!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(40)
  recommendationId?: string | null;

  @IsOptional()
  @IsBoolean()
  confirmed?: boolean;

  /** REQUIRED, against a double send from the phone (barracuda). */
  @Matches(OPERATION_ID, { message: OPERATION_ID_MESSAGE })
  clientOperationId!: string;
}
