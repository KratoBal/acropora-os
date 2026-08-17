import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

import { BARCODE_MAX_LENGTH } from "../barcode.util.js";

export class AddProductBarcodeDto {
  // Bounded here only to reject obvious junk before it reaches the parser;
  // the real normalisation and validation live in parseBarcode, where they
  // can be unit-tested without an HTTP layer. The bound is generous because
  // the raw value may still carry the whitespace a scanner appended.
  @IsString()
  @MaxLength(BARCODE_MAX_LENGTH * 2)
  code!: string;

  @IsBoolean()
  @IsOptional()
  isPrimary?: boolean;
}
