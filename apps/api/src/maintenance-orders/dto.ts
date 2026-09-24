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
