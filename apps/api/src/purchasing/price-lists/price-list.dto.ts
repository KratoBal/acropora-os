import { SUPPLIER_PRICE_LIST_FORMATS } from "@acropora/types";
import { IsIn, IsString, Matches } from "class-validator";

/** A feltöltés űrlap-mezői (a fájl külön, `file`). A formátumot a feltöltő választja. */
export class UploadPriceListDto {
  @IsString()
  supplierId!: string;

  @IsIn(SUPPLIER_PRICE_LIST_FORMATS)
  format!: (typeof SUPPLIER_PRICE_LIST_FORMATS)[number];

  /** A lista dátuma: ÉÉÉÉ-HH-NN. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  listDate!: string;

  /** ISO 4217 hárombetűs kód (kis- vagy nagybetűvel). */
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;
}
