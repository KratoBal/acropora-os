import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

/**
 * EGY TÉTEL DARAB- ÉS ALKALOMSZÁMA A KIÁLLÍTÁSKOR (Luca, 2026-11-13: „pontosan hány db és hány alkalom számot
 * szeretnék áthúzni a megrendelőbe"). Mindkettő elhagyható: ami hiányzik, az eddigi érték marad (a darabszám a
 * szerződésé, az alkalom 1).
 */
export class IssueMaintenanceOrderLineDto {
  @IsString() @MinLength(1) @MaxLength(64) itemId!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,12}([.,]\d{1,6})?$/, {
    message: "A darabszám pozitív szám legyen (legfeljebb 6 tizedessel).",
  })
  quantity?: string;
  @IsOptional() @IsInt() @Min(1) @Max(366) occasions?: number;
}

/**
 * A KIÁLLÍTÁS BEMENETE: MELYIK SZERZŐDÉS, ÉS MELYIK TÉTELEIBŐL.
 *
 * AZ `itemIds` KÖTELEZŐ ÉS NEM ÜRES -- ez tudatos, nem a mezőlista
 * véletlenszerű szigora. Balázs döntése (2026-09-24): egy kiállítás
 * alapesetben a szerződés ÖSSZES tételéből visz egy-egy alkalmat, de
 * tételenként kivehető. Ha a mező elhagyható lenne és a hiánya "mindet"
 * jelentené, egy jövőbeli kliens-hiba (üres tömb küldése "nincs kiválasztva"
 * helyett) csendben a TELJES szerződést rendelné meg. Kötelezővé téve a
 * felület kényszerül explicit listát küldeni, akkor is, ha az "az összes".
 */
export class IssueMaintenanceOrderDto {
  @IsString() @MinLength(1) @MaxLength(64) contractId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];

  /** tételenkénti darab- és alkalomszám; a hiányzó tétel az eddigi értékekkel megy */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IssueMaintenanceOrderLineDto)
  lines?: IssueMaintenanceOrderLineDto[];
}

export class RevokeMaintenanceOrderDto {
  @IsString() @MaxLength(2000) @IsOptional() reason?: string | null;
}

/**
 * KARBANTARTÁSI LAP A SZERZŐDÉSBŐL, MEGRENDELŐLAP NÉLKÜL (felmérés S4). A
 * `clientOperationId` az idempotencia kulcsa: ugyanazzal újraküldve a meglévő
 * lapot adja vissza (az űrlap a megnyitásakor generálja).
 */
export class CreateContractJobDto {
  @IsString() @MinLength(1) @MaxLength(64) contractId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];
  @IsString() @MaxLength(300) @IsOptional() title?: string | null;
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @IsOptional()
  clientOperationId?: string | null;

  /** tételenkénti darab- és alkalomszám; a hiányzó tétel az eddigi értékekkel megy (a szerződés darabszáma, 1 alkalom) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => IssueMaintenanceOrderLineDto)
  lines?: IssueMaintenanceOrderLineDto[];

  /**
   * TÉTELENKÉNT KÜLÖN LAP ÉS MUNKALAP (Luca, 2026-11-13: „a tételekből KÜLÖN KÜLÖN dokumentumban"): minden kijelölt
   * tételből egy önálló karbantartási lap a saját munkalapjával, a tétel teljes kért darab- és alkalomszámával.
   * Alapból (hamis) az eddigi: egy lap, tételenként egy munkalap.
   */
  @IsOptional() @IsBoolean() separate?: boolean;
}

/**
 * A VEVŐ SAJÁT MEGRENDELŐLAPJA (karbantartási felmérés S6): ugyanaz a
 * szerződés és tétel-lista, mint a kiállításnál, de a dokumentumot a vevő
 * adja, PDF-ként, multipart kéréssel.
 *
 * MULTIPART-BAN A TÖMB NEM JSON: az `itemIds` jöhet ismételt mezőként (a
 * multer ekkor tömböt ad), vagy egyetlen mezőben JSON-tömbként. Mindkettő
 * ugyanarra a tömbre fordul, és utána ugyanazok a szabályok állnak, mint a
 * kiállítás `itemIds`-én (kötelező, nem üres, legfeljebb 200).
 */
export function itemIdsFromMultipart(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return [trimmed];
}

export class UploadCustomerFormDto {
  @IsString() @MinLength(1) @MaxLength(64) contractId!: string;
  @Transform(({ value }) => itemIdsFromMultipart(value))
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  itemIds!: string[];
}
