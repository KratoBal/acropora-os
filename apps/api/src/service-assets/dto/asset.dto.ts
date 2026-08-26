import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";

const ASSET_KINDS = [
  "SYSTEM",
  "EQUIPMENT",
  "COMPONENT",
  "SENSOR",
  "OTHER",
] as const;
const ASSET_STATUSES = [
  "ACTIVE",
  "OUT_OF_SERVICE",
  "IN_REPAIR",
  "RETIRED",
] as const;
const ASSET_CRITICALITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
const ASSET_OWNER_TYPES = ["CUSTOMER", "SUPPLIER"] as const;
export const ASSET_DOCUMENT_TYPES = [
  "INVOICE",
  "WARRANTY",
  "MANUAL",
  "OTHER",
] as const;

export class AssetListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(ASSET_OWNER_TYPES)
  @IsOptional()
  ownerType?: (typeof ASSET_OWNER_TYPES)[number];
  @IsString() @IsOptional() ownerId?: string;
  /**
   * A tulajdonos FAJTÁJA szerinti szűkítés, egyetlen értékkel: csak azok az
   * eszközök, amiknek a gazdája aktív, SZERVIZ-jelölt partner. Ugyanaz a
   * feltétel, mint a tulajdonos-választón (`SERVICE_OWNER_WHERE`), a második
   * használati helyén.
   *
   * KÜLÖN mező, és nem az `ownerType` kiterjesztése: az egy KONKRÉT tulajdonost
   * nevez meg az `ownerId`-vel együtt, ez pedig egy halmazt. Elhagyva a lista
   * változatlan marad -- a webes nyilvántartásnak a teljesség az értéke.
   */
  @IsIn(["SERVICE_PARTNER"]) @IsOptional() ownerScope?: "SERVICE_PARTNER";
  @IsString() @IsOptional() aquariumId?: string;
  @IsString() @IsOptional() parentAssetId?: string;
  @IsIn([...ASSET_STATUSES, "ALL"]) @IsOptional() status:
    (typeof ASSET_STATUSES)[number] | "ALL" = "ACTIVE";
  @IsIn(ASSET_KINDS) @IsOptional() kind?: (typeof ASSET_KINDS)[number];
  @IsISO8601() @IsOptional() dueBefore?: string;
}

/**
 * A tulajdonos-választó lekérdezése.
 *
 * A két mező EGYÜTT jelent valamit: egy MÁR RÖGZÍTETT eszköz tulajdonosa, akit a
 * lista akkor is tartalmazzon, ha ma nem lenne választható. A szerkesztő
 * képernyő küldi, az új felvétel nem.
 */
export class AssetOwnersQueryDto {
  @IsIn(ASSET_OWNER_TYPES)
  @IsOptional()
  ownerType?: (typeof ASSET_OWNER_TYPES)[number];
  @IsString() @IsOptional() ownerId?: string;
}

export class CreateAssetDto {
  @IsIn(ASSET_OWNER_TYPES) ownerType!: (typeof ASSET_OWNER_TYPES)[number];
  @IsString() @MinLength(1) ownerId!: string;
  @IsString() @IsOptional() customerAddressId?: string;
  @IsString() @IsOptional() aquariumId?: string;
  @IsString() @IsOptional() parentAssetId?: string;
  @IsString() @IsOptional() productVariantId?: string;
  @IsIn(ASSET_KINDS) kind!: (typeof ASSET_KINDS)[number];
  @IsIn(ASSET_STATUSES) @IsOptional() status?: (typeof ASSET_STATUSES)[number];
  @IsIn(ASSET_CRITICALITIES)
  @IsOptional()
  criticality?: (typeof ASSET_CRITICALITIES)[number];
  @IsString() @MinLength(1) name!: string;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() manufacturer?: string;
  @IsString() @IsOptional() model?: string;
  @IsString() @IsOptional() serialNumber?: string;
  @IsString() @IsOptional() inventoryNumber?: string;
  @IsString() @IsOptional() description?: string;
  @IsISO8601() @IsOptional() installedAt?: string;
  @IsISO8601() @IsOptional() purchasedAt?: string;
  @IsISO8601() @IsOptional() warrantyExpiresAt?: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  serviceIntervalDays?: number;
  @IsISO8601() @IsOptional() lastServicedAt?: string;
  @IsISO8601() @IsOptional() nextServiceAt?: string;
  @IsString() @IsOptional() notes?: string;
}

export class UpdateAssetDto {
  @IsIn(ASSET_OWNER_TYPES)
  @IsOptional()
  ownerType?: (typeof ASSET_OWNER_TYPES)[number];
  @IsString() @MinLength(1) @IsOptional() ownerId?: string;
  @IsString() @IsOptional() customerAddressId?: string | null;
  @IsString() @IsOptional() aquariumId?: string | null;
  @IsString() @IsOptional() parentAssetId?: string | null;
  @IsString() @IsOptional() productVariantId?: string | null;
  @IsIn(ASSET_KINDS) @IsOptional() kind?: (typeof ASSET_KINDS)[number];
  @IsIn(ASSET_STATUSES) @IsOptional() status?: (typeof ASSET_STATUSES)[number];
  @IsIn(ASSET_CRITICALITIES)
  @IsOptional()
  criticality?: (typeof ASSET_CRITICALITIES)[number];
  @IsString() @MinLength(1) @IsOptional() name?: string;
  @IsString() @IsOptional() category?: string | null;
  @IsString() @IsOptional() manufacturer?: string | null;
  @IsString() @IsOptional() model?: string | null;
  @IsString() @IsOptional() serialNumber?: string | null;
  @IsString() @IsOptional() inventoryNumber?: string | null;
  @IsString() @IsOptional() description?: string | null;
  @IsISO8601() @IsOptional() installedAt?: string | null;
  @IsISO8601() @IsOptional() purchasedAt?: string | null;
  @IsISO8601() @IsOptional() warrantyExpiresAt?: string | null;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  @IsOptional()
  serviceIntervalDays?: number | null;
  @IsISO8601() @IsOptional() lastServicedAt?: string | null;
  @IsISO8601() @IsOptional() nextServiceAt?: string | null;
  @IsString() @IsOptional() notes?: string | null;
  @IsISO8601() expectedUpdatedAt!: string;
}

export class UploadAssetDocumentDto {
  @IsIn(ASSET_DOCUMENT_TYPES)
  type!: (typeof ASSET_DOCUMENT_TYPES)[number];
}
