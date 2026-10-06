import {
  WEBSHOP_CARRIER_NOTE_MAX,
  WEBSHOP_CUSTOMER_NOTE_MAX,
  type WebshopOrderAddressInput,
  type WebshopOrderNotesInput,
} from "@acropora/types";
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

/** A csomagpont cseréje: a választott pont a webshop listájából. */
export class WebshopOrderPointDto {
  @IsString() @MinLength(1) @MaxLength(100) pointId!: string;
}

/** A vevő és a szállító megjegyzése; a hiányzó mező nem változik, az üres töröl. */
export class WebshopOrderNotesDto implements WebshopOrderNotesInput {
  @IsOptional()
  @IsString()
  @MaxLength(WEBSHOP_CUSTOMER_NOTE_MAX)
  customerNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(WEBSHOP_CARRIER_NOTE_MAX)
  carrierNote?: string;
}
