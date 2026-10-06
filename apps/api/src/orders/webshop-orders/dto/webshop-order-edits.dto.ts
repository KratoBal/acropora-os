import {
  WEBSHOP_CARRIER_NOTE_MAX,
  WEBSHOP_CUSTOMER_NOTE_MAX,
  type WebshopOrderAddressInput,
  type WebshopOrderMethodInput,
  type WebshopOrderNotesInput,
  type WebshopOrderSplitInput,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
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

/** Egy kijelölt tétel a bontáshoz. */
export class WebshopOrderSplitLineDto {
  @IsString() @MinLength(1) @MaxLength(100) itemId!: string;
  @IsInt() @Min(1) quantity!: number;
}

/** A szétbontás: a kijelölt tételek, és a párbeszédablak kérés-azonosítója. */
export class WebshopOrderSplitDto implements WebshopOrderSplitInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WebshopOrderSplitLineDto)
  lines!: WebshopOrderSplitLineDto[];

  @IsString() @MinLength(1) @MaxLength(100) requestId!: string;
}

/** A szállítási mód cseréje: a webshop listájából a mód, pontos módnál a pont is. */
export class WebshopOrderMethodDto implements WebshopOrderMethodInput {
  @IsString() @MinLength(1) @MaxLength(100) optionId!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) pointId?: string;
}
