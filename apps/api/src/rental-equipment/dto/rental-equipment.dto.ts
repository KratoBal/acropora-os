import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from "class-validator";

import { RENTAL_EQUIPMENT_LIMITS as L } from "@acropora/types";

import { optionalQueryBoolean } from "../../common/query-boolean.util.js";

/**
 * A blank text amount is NOT zero. `@Type(() => Number)` alone turns "" into 0 and `@IsInt` passes it, so an empty field
 * from an API client would store a 0 Ft fee (barracuda, #2270 review). The raw value decides: blank text becomes NaN, which
 * `@IsInt` refuses, on create and on update alike.
 */
export const blankAmountIsInvalid = ({
  value,
  obj,
  key,
}: {
  value: unknown;
  obj: Record<string, unknown>;
  key: string;
}) =>
  typeof obj[key] === "string" && (obj[key] as string).trim() === ""
    ? Number.NaN
    : value;

const AMOUNT_MESSAGE = `Az összeg 0 és ${L.amountHuf.max} Ft közötti egész szám legyen.`;

export class RentalEquipmentListQueryDto {
  /** A query-string boolean is text: `"false"` must stay false, see `query-boolean.util.ts`. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateRentalEquipmentDto {
  @IsString()
  @MinLength(L.name.min, { message: "Az eszköz nevét meg kell adni." })
  @MaxLength(L.name.max)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(L.serialNumber.max)
  serialNumber?: string | null;

  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  dailyFeeHuf!: number;

  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  depositHuf!: number;

  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  replacementValueHuf!: number;

  @IsOptional()
  @IsString()
  @MaxLength(L.accessories.max)
  accessories?: string | null;

  @IsOptional() @IsString() @MaxLength(L.note.max) note?: string | null;
}

/**
 * Every field optional; the three text fields accept `null` to clear them. Retiring goes through `isActive`, the same as the
 * other Settings lists.
 */
export class UpdateRentalEquipmentDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(L.name.min, {
    message: "Az eszköz nevét nem lehet üresen hagyni.",
  })
  @MaxLength(L.name.max)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.serialNumber.max)
  serialNumber?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  dailyFeeHuf?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  depositHuf?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: AMOUNT_MESSAGE })
  @Min(L.amountHuf.min, { message: AMOUNT_MESSAGE })
  @Max(L.amountHuf.max, { message: AMOUNT_MESSAGE })
  replacementValueHuf?: number;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.accessories.max)
  accessories?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(L.note.max)
  note?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
