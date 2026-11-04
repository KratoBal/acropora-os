import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

export class IssueCompletionCertificateDto {
  @IsString() @MinLength(1) @MaxLength(64) serviceJobId!: string;
}

/** Egy igazolandó tétel a megrendelésből: a tétel és a mennyiség szövegként (Megrendelések S2). */
export class PartnerOrderCertificateLineDto {
  @IsString() @MinLength(1) @MaxLength(64) quoteItemId!: string;
  @IsString() @MinLength(1) @MaxLength(32) quantity!: string;
}

/**
 * TIG A MEGRENDELÉSBŐL. A `lines` hiánya vagy üressége: minden tétel a teljes
 * hátralévővel; megadva: részteljesítés, a kért tételekkel és mennyiségekkel.
 */
export class IssuePartnerOrderCertificateDto {
  @IsString() @MinLength(1) @MaxLength(64) partnerOrderId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PartnerOrderCertificateLineDto)
  lines?: PartnerOrderCertificateLineDto[];
}
