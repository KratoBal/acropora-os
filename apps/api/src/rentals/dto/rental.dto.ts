import { Transform, Type } from "class-transformer";
import {
  IsDefined,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

import {
  RENTAL_EQUIPMENT_LIMITS,
  RENTAL_LIMITS,
  RENTAL_STATUSES,
} from "@acropora/types";

import { blankAmountIsInvalid } from "../../rental-equipment/dto/rental-equipment.dto.js";

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;
const blankIsMissing = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

/**
 * THE RENTER'S ADDRESS. Required in full: the contract names the renter, and a device that does not come back is chased at
 * this address (Balázs: "cím, email, telefon is kell").
 */
export class RentalCustomerAddressDto {
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "Az irányítószámot meg kell adni." })
  postalCode!: string;
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "A várost meg kell adni." })
  city!: string;
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "Az utcát és házszámot meg kell adni." })
  line1!: string;
  @Transform(blankIsMissing) @IsOptional() @IsString() line2?: string;
}

/** A NEW renter, written to the existing customer register (Balázs approved: no separate renter table). */
export class RentalNewCustomerDto {
  @IsIn(["PERSON", "COMPANY"]) type!: "PERSON" | "COMPANY";
  @Transform(trimmed)
  @IsString()
  @MinLength(1, { message: "A bérlő nevét meg kell adni." })
  @MaxLength(200)
  displayName!: string;
  @Transform(blankIsMissing) @IsOptional() @IsString() companyName?: string;
  @Transform(blankIsMissing) @IsOptional() @IsString() taxNumber?: string;
  @Transform(trimmed)
  @IsEmail({}, { message: "Érvényes e-mail címet adj meg." })
  email!: string;
  @Transform(trimmed)
  @IsString()
  @MinLength(6, { message: "A telefonszámot meg kell adni." })
  @MaxLength(40)
  phone!: string;
  // without IsDefined a missing address passes: ValidateNested skips undefined
  @IsDefined({ message: "A bérlő címét meg kell adni." })
  @ValidateNested()
  @Type(() => RentalCustomerAddressDto)
  address!: RentalCustomerAddressDto;
}

export class CreateRentalDto {
  @IsString() @MinLength(1) equipmentId!: string;

  /** Either an existing customer, or a new one; the service refuses both and neither. */
  @IsOptional() @IsString() @MinLength(1) customerId?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => RentalNewCustomerDto)
  newCustomer?: RentalNewCustomerDto;

  /** An instant (the desk's local time converted by the client): `2026-11-06T09:30:00.000Z`. */
  @IsISO8601({ strict: true }, { message: "A kezdés időpontja hibás." })
  startsAt!: string;
  @IsISO8601(
    { strict: true },
    { message: "A tervezett visszahozás időpontja hibás." },
  )
  plannedReturnAt!: string;

  /** Omitted: the device's own deposit. Given: what the desk agreed on. */
  @IsOptional()
  @Type(() => Number)
  @Transform(blankAmountIsInvalid)
  @IsInt({ message: "A kaució egész forintösszeg legyen." })
  @Min(RENTAL_EQUIPMENT_LIMITS.amountHuf.min)
  @Max(RENTAL_EQUIPMENT_LIMITS.amountHuf.max)
  depositHuf?: number;

  @Transform(blankIsMissing)
  @IsOptional()
  @IsString()
  @MaxLength(RENTAL_LIMITS.note.max)
  note?: string;
}

export class RentalListQueryDto {
  @IsOptional()
  @IsIn(RENTAL_STATUSES)
  status?: (typeof RENTAL_STATUSES)[number];
}

/** What the desk typed so far; any of the three may be empty. */
export class RentalCustomerMatchQueryDto {
  @Transform(blankIsMissing)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
  @Transform(blankIsMissing)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
  @Transform(blankIsMissing)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;
}
