import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export const WORKSHEET_VERSION_STATUSES = [
  "DRAFT",
  "AWAITING_SIGNATURE",
  "SIGNED",
  "REJECTED",
] as const;

export const WORKSHEET_SIGNATURE_DECISIONS = ["ACCEPTED", "REJECTED"] as const;

export class WorksheetListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(10) @Max(100) @IsOptional() pageSize = 25;
  @IsString() @IsOptional() search?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() departmentId?: string;
  /** A szerelő saját lapjai: erre a szűrőre épül a "nekem kiosztva" lista. */
  @IsString() @IsOptional() assigneeId?: string;
  // Állapot szerinti szűrés szándékosan nincs: az állapot a LEGUTOLSÓ
  // verzióé, a `some: { status }` alakú Prisma-szűrő viszont bármelyik
  // korábbi verzióra is illeszkedne, és csendben mást jelentene, mint amit
  // a felületen ígér. Amíg nincs rá helyes (nyers) lekérdezés, nincs szűrő.
}

export class WorksheetLineDto {
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(500) @IsOptional() detail?: string | null;
  @IsString() @IsOptional() assetId?: string | null;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) quantity!: number;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) unitNet!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) vatRatePercent!: number;
}

/**
 * Egy sor önmagában, a lap többi tartalma nélkül.
 *
 * Az `id`-t a KLIENS adhatja meg, és ez nem kényelmi lehetőség: a helyszíni
 * rögzítés sorba áll, és egy megszakadt küldést a telefon újraküld. Szerver
 * oldali azonosító mellett az újraküldés második sort hozna létre - a
 * szerelő pedig azt látná, hogy mindent kétszer rögzített. Ugyanaz a
 * megfontolás, mint a Task modell `source` + `sourceRef` párosánál.
 */
export class CreateWorksheetLineDto extends WorksheetLineDto {
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, {
    message:
      "A sor azonosítója 8-64 karakter lehet, betű, szám, kötőjel és aláhúzás.",
  })
  @IsOptional()
  id?: string;
}

/** Egy sor teljes tartalma. A sorok kicsik és önállóak, ezért a módosítás
 * egészben cseréli a sort - így nem kell találgatni, melyik mezőt szánták
 * változatlannak és melyiket üresnek. */
export class UpdateWorksheetLineDto extends WorksheetLineDto {}

export class WorksheetContentDto {
  @IsString() @MinLength(1) @MaxLength(500) subject!: string;
  // Az alegység NEM része a beküldött tartalomnak: a munkalap alegységéből
  // másolódik a verzióra. Egy külön szerkeszthető szövegmező mellett a szám
  // középső tagja és a lapon látható egység elcsúszhatna egymástól, pedig
  // ez egy fogalom.
  @IsString() @MaxLength(4000) @IsOptional() description?: string | null;
  @IsISO8601() @IsOptional() issueDate?: string | null;
  @IsISO8601() @IsOptional() fulfillmentDate?: string | null;
  @IsISO8601() @IsOptional() dueDate?: string | null;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => WorksheetLineDto)
  lines: WorksheetLineDto[] = [];
}

export class CreateWorksheetDto extends WorksheetContentDto {
  @IsString() @MinLength(1) customerId!: string;
  @IsString() @MinLength(1) departmentId!: string;
}

export class UpdateWorksheetDraftDto extends WorksheetContentDto {}

export class AmendWorksheetDto extends WorksheetContentDto {
  /** Az indoklás kötelező: enélkül a napló nem mond semmit arról, miért módosult egy kiadott dokumentum. */
  @IsString() @MinLength(3) @MaxLength(1000) changeReason!: string;
}

export class SignWorksheetVersionDto {
  @IsIn(WORKSHEET_SIGNATURE_DECISIONS)
  decision!: (typeof WORKSHEET_SIGNATURE_DECISIONS)[number];
  @IsString() @MinLength(2) @MaxLength(200) signerName!: string;
  @IsString() @MaxLength(1000) @IsOptional() note?: string | null;
}

export class CreateWorksheetDepartmentDto {
  @Matches(/^[A-Za-z]{1,3}$/, {
    message: "A részleg kódja legfeljebb három betű lehet (pl. BIO).",
  })
  code!: string;
  /**
   * Every rule spells out its own message. The default validator text is
   * English, and this form is filled in by shop staff: "name must be a string"
   * tells them nothing about what to type, and it arrives next to a Hungarian
   * sentence, which reads like a broken screen rather than a correction.
   */
  @IsString({ message: "Az alegység nevét meg kell adni." })
  @MinLength(2, { message: "Az alegység neve legalább két karakter legyen." })
  @MaxLength(200, {
    message: "Az alegység neve legfeljebb 200 karakter lehet.",
  })
  name!: string;
}

/**
 * A lap felelőseinek teljes listája.
 *
 * A mező kötelező, alapértelmezett üres lista nélkül: egy elgépelt vagy
 * kimaradt mezőnek nem szabad csendben leszedni mindenkit a lapról. Üres
 * listát küldeni viszont szabad - az kimondott szándék.
 */
export class SetWorksheetAssigneesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  userIds!: string[];
}

export class SetWorksheetPartnerCodeDto {
  @Matches(/^[A-Za-z][A-Za-z0-9]{1,7}$/, {
    message:
      "A partner rövidítése betűvel kezdődő, 2-8 karakteres kód lehet (pl. FANK).",
  })
  partnerCode!: string;
}
