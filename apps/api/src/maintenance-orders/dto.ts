import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

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
