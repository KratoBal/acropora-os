import { IsOptional, IsString, MaxLength } from "class-validator";

/** Új termék felvétele előtt: van-e már termék ezzel az EAN-nel vagy beszállítói cikkszámmal. */
export class PurchaseProductConflictQueryDto {
  @IsString() @MaxLength(14) @IsOptional() ean?: string;
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @MaxLength(100) @IsOptional() supplierSku?: string;
}
