import {
  WEBSHOP_SHORTAGE_CHANNELS,
  WEBSHOP_SHORTAGE_CHOICES,
  type WebshopOrderShortageAgreementInput,
  type WebshopOrderShortageOpenInput,
  type WebshopOrderShortageResolveInput,
} from "@acropora/types";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class WebshopShortageOpenLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  itemId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  availableQuantity?: number;
}

/** A hiány felvétele: a tételek, és ha ismert, mennyi van belőlük. A rendelt mennyiséget a szerver olvassa a rendelésből. */
export class WebshopShortageOpenDto implements WebshopOrderShortageOpenInput {
  @ValidateNested({ each: true })
  @Type(() => WebshopShortageOpenLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  lines!: WebshopShortageOpenLineDto[];
}

export class WebshopShortageAgreementLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  itemId!: string;

  @IsInt()
  @Min(0)
  agreedQuantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  replacementVariantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  replacementSku?: string;
}

export class WebshopShortageAgreementDto implements WebshopOrderShortageAgreementInput {
  @IsIn([...WEBSHOP_SHORTAGE_CHOICES])
  choice!: WebshopOrderShortageAgreementInput["choice"];

  @IsIn([...WEBSHOP_SHORTAGE_CHANNELS])
  channel!: WebshopOrderShortageAgreementInput["channel"];

  @IsOptional()
  @IsISO8601()
  agreedAt?: string;

  @IsString()
  @MaxLength(2000)
  note!: string;

  @ValidateNested({ each: true })
  @Type(() => WebshopShortageAgreementLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  lines!: WebshopShortageAgreementLineDto[];
}

export class WebshopShortageResolveDto implements WebshopOrderShortageResolveInput {
  @IsIn(["done", "withdrawn"])
  outcome!: WebshopOrderShortageResolveInput["outcome"];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  splitOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
