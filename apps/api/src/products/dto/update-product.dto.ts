import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

import { PRODUCT_TYPES, type ProductTypeValue } from "./create-product.dto.js";

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  productType?: ProductTypeValue;

  @IsOptional()
  @IsString()
  brandId?: string | null;

  @IsOptional()
  @IsString()
  primaryCategoryId?: string | null;

  /** @deprecated Használd a primaryCategoryId mezőt. */
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  /**
   * A SAJÁT webshopunkban megvásárolható-e; a felületen "Vásárolható".
   *
   * NEM a UNAS publikációs állapotának tükre -- azt a `ChannelListing`
   * hordozza, és azt a szinkron írja. Ez Acropora-tulajdonú üzleti döntés,
   * és ez az ELSŐ út, amin igazra lehet állítani: eddig a mező hat helyen
   * szerepelt a fában, mind olvasásként.
   */
  @IsOptional()
  @IsBoolean()
  webshopSellable?: boolean;

  /** Acropora-owned advisor decision; deliberately absent from UNAS sync. */
  @IsOptional()
  @IsIn(["PLACEMENT", "CAPACITY"])
  advisorKind?: "PLACEMENT" | "CAPACITY" | null;

  /** Acropora-owned datasheet data; deliberately absent from UNAS sync. */
  @IsOptional()
  @IsIn(["GYENGE", "KOZEPES", "EROS", "NEM_ERTELMEZHETO"])
  fenyIgeny?: "GYENGE" | "KOZEPES" | "EROS" | "NEM_ERTELMEZHETO" | null;

  /** Acropora-owned datasheet data; deliberately absent from UNAS sync. */
  @IsOptional()
  @IsIn(["GYENGE", "KOZEPES", "EROS", "NEM_ERTELMEZHETO"])
  aramlasIgeny?: "GYENGE" | "KOZEPES" | "EROS" | "NEM_ERTELMEZHETO" | null;

  /**
   * A nevek az adatlapon (kartya 20b0dd47): Acropora-tulajdonu, a UNAS-szinkronbol szandekosan hianyzik. A szoveg
   * kerul (a szokozok levagva), az ures szoveg torli a nevet.
   */
  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  magyarNev?: string | null;

  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  angolNev?: string | null;

  @IsOptional()
  @Transform(trimmedName)
  @IsString()
  @MaxLength(200)
  nemetNev?: string | null;
}

/** A szoveg a szokozok nelkul; ami nem szoveg, valtozatlan (a validator utasitja el). */
function trimmedName({ value }: { value: unknown }): unknown {
  return typeof value === "string" ? value.trim() : value;
}
