import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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

/**
 * A query sztring nem hordoz tömböt: egy érték sztringként, több érték tömbként
 * vagy egyetlen vesszős sztringként érkezik. Mindhármat ugyanarra hozzuk.
 *
 * Az üres darabokat eldobjuk, de az ÜRES EREDMÉNYT `undefined`-re visszük, nem
 * üres tömbre: egy `?departmentIds=` alak így „nem szűrünk" marad, és nem
 * változik némán „egyetlen sort sem adunk vissza" jelentésűvé.
 */
export function toIdList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : [value];
  const ids = raw
    .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return ids.length > 0 ? ids : undefined;
}

export class AssetListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsIn(ASSET_OWNER_TYPES)
  @IsOptional()
  ownerType?: (typeof ASSET_OWNER_TYPES)[number];
  @IsString() @IsOptional() ownerId?: string;
  /**
   * MATRICA SZERINTI SZUKITES: `with` vagy `without`.
   *
   * MIERT VAN, HOLOTT MA NINCS HOZZA KEPERNYO. Balazs dontese szerint a
   * matrica a felvitelnel NEM kotelezo (2026-09-02 19:24), es az indok az,
   * hogy egy szerelo, akinel elfogyott a matrica, ne akadjon el a helyszinen.
   * EBBOL VISZONT KOVETKEZIK, hogy keletkezni fog egy halmaz, amit valakinek
   * vegig kell jarnia -- es egy szandekosan megengedett allapot CSENDBEN
   * halmozodik, ha semmi nem tudja megkerdezni.
   *
   * Ez a szuro teszi MEGKERDEZHETOVE. Most nehany sor; kesobb egy kulon kor.
   */
  @IsIn(["with", "without"])
  @IsOptional()
  label?: "with" | "without";
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
  /**
   * A PARTNER ALEGYSÉGE, ÉS A SZŰRÉS A RÉSZFÁRA SZÓL, nem csak a megnevezett
   * csomópontra: a „Biodóm" alatti medencéken lógó eszközök is benne vannak.
   * Az indok a `unit-subtree.ts` jegyzetében áll -- röviden: az eszköz bármelyik
   * csomóponthoz köthető, tehát a pontos egyezés csendben hiányos listát adna.
   */
  @IsString() @IsOptional() departmentId?: string;
  /**
   * TÖBB ALEGYSÉG, ÉS A VÁLASZ A RÉSZFÁIK UNIÓJA.
   *
   * MIÉRT KELL A TÖBBES ALAK: a tulajdonos döntése szerint egy emberhez EGY VAGY
   * TÖBB fa-csomópont rendelhető, és ő azt és mindent alatta lát. Egy csomópont
   * tehát nem elég hatókörnek.
   *
   * KÜLÖN MEZŐ, ÉS NEM A `departmentId` KITERJESZTÉSE: a singularis név egy
   * értéket ígér, és a két mező együtt is megadható -- a szűrő az összes megadott
   * azonosító részfáinak az uniója. Így a meglévő hívások betűre változatlanok.
   *
   * Ismételt paraméterként (`?departmentIds=a&departmentIds=b`) és vesszővel
   * elválasztva is megadható: a query sztringben nincs tömb-típus, és egy
   * felület mindkét alakot természetesnek találja.
   */
  @Transform(({ value }) => toIdList(value))
  @IsString({ each: true })
  @IsOptional()
  departmentIds?: string[];
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
  /** A partner ALEGYSÉGE (a partner képernyőn ez a neve). Csak szerviz partner
   * tulajdonosnál értelmes; vevőnél a `customerAddressId` a pontosítás. */
  @IsString() @IsOptional() departmentId?: string;
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
  /** Előre nyomtatott matrica kódja (egy betű és négy szám, pl. V2196). Az
   * ALAKOT a szolgáltatás ellenőrzi a közös `normalizeAssetLabelCode`
   * függvénnyel, nem itt egy második mintával: két minta két helyen pontosan
   * ott csúszna el, ahol senki nem nézi. */
  @IsString() @IsOptional() labelCode?: string;
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
  /** `null` törli a kötést, a mező elhagyása érintetlenül hagyja. */
  @IsString() @IsOptional() departmentId?: string | null;
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

/**
 * MATRICAK KIADASA. Egy nyomtatott iv kodjai egy hivasban.
 *
 * A FELSO HATAR NEM ONKENYES: egy iv legfeljebb nehany szaz matricat hordoz,
 * es egy korlatlan lista egy elgepelt ciklusbol is erkezhet. A hatar itt all,
 * a DTO-ban, hogy a szolgaltatas ne egy mar beolvasott, tetszoleges meretu
 * tombbel talalkozzon.
 */
export class IssueAssetLabelsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  codes!: string[];
}

/** A szabad matricak lekerdezesenek hatara. */
export class FreeAssetLabelsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  limit?: number;
}
