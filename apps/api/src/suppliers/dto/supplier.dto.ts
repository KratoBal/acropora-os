import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
} from "class-validator";

/** The worksheet number's first segment. Uppercase so that two codes differing
 * only in case cannot both exist -- on paper they would look identical. */
export const PARTNER_CODE = /^[A-Z0-9]{4}$/;
export const PARTNER_CODE_MESSAGE =
  "A partnerkód pontosan négy karakter, nagybetűkből vagy számjegyekből (például FANK).";

export class CreateSupplierDto {
  @IsString() @MinLength(1) name!: string;
  /** Left out means "as the column defaults": supplier yes, service no. The
   * purchase invoice screen creates suppliers without knowing about partner
   * kinds, and it must keep working unchanged. */
  @IsBoolean() @IsOptional() isSupplier?: boolean;
  @IsBoolean() @IsOptional() isService?: boolean;
  /** Exactly four characters. Digits are allowed alongside letters: an
   * abbreviation like `H2O1` is entirely plausible in this trade, and the rule
   * that matters for the number's shape is the length, not the alphabet. */
  @Matches(PARTNER_CODE, { message: PARTNER_CODE_MESSAGE })
  @IsOptional()
  worksheetPartnerCode?: string;
  @IsString() @IsOptional() taxNumber?: string;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() iban?: string;
  @IsString() @IsOptional() swiftCode?: string;
  @IsString() @IsOptional() bankAccountNumber?: string;
  @IsString() @IsOptional() contactPersonName?: string;
  @IsString() @IsOptional() contactPersonPhone?: string;
  @IsString() @IsOptional() contactPersonEmail?: string;
  @IsString() @IsOptional() postalCode?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() addressLine1?: string;
  @IsString() @IsOptional() addressLine2?: string;
}

export class UpdateSupplierDto {
  @IsString() @MinLength(1) @IsOptional() name?: string;
  @IsBoolean() @IsOptional() isSupplier?: boolean;
  @IsBoolean() @IsOptional() isService?: boolean;
  /** `null` clears it. An empty string would be a fifth kind of nothing next
   * to null, undefined and an absent field, and the column is unique -- two
   * partners "without a code" stored as "" would collide. */
  @Matches(PARTNER_CODE, { message: PARTNER_CODE_MESSAGE })
  @IsOptional()
  worksheetPartnerCode?: string | null;
  @IsString() @IsOptional() taxNumber?: string | null;
  @IsString() @IsOptional() country?: string;
  @IsString() @IsOptional() email?: string | null;
  @IsString() @IsOptional() phone?: string | null;
  @IsString() @IsOptional() iban?: string | null;
  @IsString() @IsOptional() swiftCode?: string | null;
  @IsString() @IsOptional() bankAccountNumber?: string | null;
  @IsString() @IsOptional() contactPersonName?: string | null;
  @IsString() @IsOptional() contactPersonPhone?: string | null;
  @IsString() @IsOptional() contactPersonEmail?: string | null;
  @IsString() @IsOptional() postalCode?: string | null;
  @IsString() @IsOptional() city?: string | null;
  @IsString() @IsOptional() addressLine1?: string | null;
  @IsString() @IsOptional() addressLine2?: string | null;
  @IsString() expectedUpdatedAt!: string;
}

export class SupplierListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(["DOMESTIC", "EU"]) @IsOptional() countryScope?: "DOMESTIC" | "EU";
  /** Which kind of partner to list. Left out means both, which is what the
   * screen calls "Mind". Resolved in the database rather than by filtering an
   * already-paged result, so the page count stays truthful. */
  @IsIn(["SUPPLIER", "SERVICE"]) @IsOptional() kind?: "SUPPLIER" | "SERVICE";
  @IsIn(["ACTIVE", "INACTIVE", "ALL"]) @IsOptional() status:
    "ACTIVE" | "INACTIVE" | "ALL" = "ACTIVE";
}
