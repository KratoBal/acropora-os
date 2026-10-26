import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * AZ AKVÁRIUMHOZ FELVITT ÚJ ÜGYFÉL: CSAK A NÉV KÖTELEZŐ (Luca kérése, task
 * os-ugyfel-akvarium-hianyos). A helyszínen nincs mindig minden adat (irányítószám,
 * e-mail), a mérés rögzítése pedig nem állhat meg miatta; a hiányt utóbb
 * pótolja valaki (Tamás). A teljes `CreateCustomerDto` (az Ügyfelek lap
 * felvitele) változatlanul szigorú marad: ott a cím teljes alakja elvárás.
 *
 * AMIT EZ AZ OSZTÁLY MÁSKÉPP TESZ:
 *  - az üres szöveg HIÁNYZÓ mező (nem `""`): egy üres e-mail nem bukik az
 *    `@IsEmail`-en, és a `Customer.email` nem `""`-t kap;
 *  - a TELJESEN üres cím-sor eldobódik (a webes űrlap üresen is elküldi);
 *  - a RÉSZBEN kitöltött cím (pl. város és utca irányítószám nélkül) megmarad,
 *    a hiányzó részek üres szöveggel. A számla kiállításakor az ilyen cím
 *    hiányosnak számít (`billing-document-issue.ts`), ott jelzi a hiányt.
 * A meglévő sorokat ez nem érinti: csak a bemenet validációja változik.
 */
const hianyzo = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() || undefined : value;

const kitoltott = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : (value ?? "");

export class AquariumCustomerAddressDto {
  @IsIn(["BILLING", "SHIPPING", "OTHER"]) type!:
    "BILLING" | "SHIPPING" | "OTHER";
  @Transform(hianyzo) @IsString() @IsOptional() name?: string;
  @Transform(hianyzo) @IsString() @IsOptional() country?: string;
  @Transform(kitoltott) @IsString() postalCode: string = "";
  @Transform(kitoltott) @IsString() city: string = "";
  @Transform(kitoltott) @IsString() line1: string = "";
  @Transform(hianyzo) @IsString() @IsOptional() line2?: string;
  @IsBoolean() @IsOptional() isDefault = false;
}

/** Igaz, ha a cím három fő része (irányítószám, város, utca) mind üres. */
export const addressIsBlank = (address: unknown): boolean => {
  const a = (address ?? {}) as Record<string, unknown>;
  return ["postalCode", "city", "line1"].every(
    (key) => typeof a[key] !== "string" || (a[key] as string).trim() === "",
  );
};

export class CreateAquariumCustomerDto {
  @IsIn(["PERSON", "COMPANY"]) type!: "PERSON" | "COMPANY";
  @Transform(kitoltott) @IsString() @MinLength(1) displayName!: string;
  @Transform(hianyzo) @IsString() @IsOptional() companyName?: string;
  @Transform(hianyzo) @IsString() @IsOptional() taxNumber?: string;
  @Transform(hianyzo) @IsString() @IsOptional() euTaxNumber?: string;
  @Transform(hianyzo) @IsEmail() @IsOptional() email?: string;
  @Transform(hianyzo) @IsString() @IsOptional() phone?: string;
  @IsBoolean() @IsOptional() marketingEmailConsent = false;
  @IsBoolean() @IsOptional() marketingSmsConsent = false;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AquariumCustomerAddressDto)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.filter((address) => !addressIsBlank(address))
      : value,
  )
  @IsOptional()
  addresses: AquariumCustomerAddressDto[] = [];
}
