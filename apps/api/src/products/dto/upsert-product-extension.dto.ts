import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

const DECIMAL_PATTERN = /^\d{1,13}(?:\.\d{1,6})?$/;

export class UpsertProductExtensionDto {
  @IsOptional()
  @IsString()
  preferredSupplierId?: string | null;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  defaultPurchaseCurrency?: string | null;

  @IsOptional()
  @IsString()
  defaultWarehouseId?: string | null;

  @IsOptional()
  @IsString()
  defaultLocationId?: string | null;

  @IsOptional()
  @Matches(DECIMAL_PATTERN)
  minimumStock?: string | null;

  @IsOptional()
  @Matches(DECIMAL_PATTERN)
  optimalStock?: string | null;

  @IsOptional()
  @Matches(DECIMAL_PATTERN)
  reorderPoint?: string | null;

  @IsOptional()
  @Matches(DECIMAL_PATTERN)
  safetyStock?: string | null;

  @IsOptional()
  @IsBoolean()
  stockTrackingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  purchasingDisabled?: boolean;

  @IsOptional()
  @IsBoolean()
  phaseOut?: boolean;

  @IsOptional()
  @IsBoolean()
  autoReorderEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNote?: string | null;
}
