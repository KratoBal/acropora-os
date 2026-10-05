import type { WebshopOrderAddressInput } from "@acropora/types";
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from "class-validator";

/** Egy cím az adatlapról. A kötelező mezők a csomagfeladás és a számla mezői. */
export class WebshopOrderAddressDto implements WebshopOrderAddressInput {
  @IsIn(["billing", "shipping"])
  kind!: "billing" | "shipping";

  @IsString() @MinLength(1) @MaxLength(120) lastName!: string;
  @IsString() @MinLength(1) @MaxLength(120) firstName!: string;
  @IsOptional() @IsString() @MaxLength(200) company!: string | null;
  @IsOptional() @IsString() @MaxLength(40) taxNumber!: string | null;
  @IsString() @MinLength(1) @MaxLength(20) postalCode!: string;
  @IsString() @MinLength(1) @MaxLength(120) city!: string;
  @IsString() @MinLength(1) @MaxLength(200) line1!: string;
  @IsOptional() @IsString() @MaxLength(200) line2!: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone!: string | null;
  @IsString() @Length(2, 2) countryCode!: string;
}

/** A belső megjegyzés; üres szöveg törli. */
export class WebshopOrderNoteDto {
  @IsString() @MaxLength(2000) text!: string;
}
