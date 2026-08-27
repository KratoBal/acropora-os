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
  /**
   * ÁLLAPOT SZERINTI SZŰRÉS, a LEGUTOLSÓ verzió állapotára.
   *
   * Sokáig szándékosan nem volt ilyen szűrő, és az indok most is érvényes: a
   * kézenfekvő `some: { status }` alakú Prisma-feltétel BÁRMELYIK korábbi
   * verzióra illeszkedne, tehát egy háromszor átírt, ma már aláírt lap
   * továbbra is feljönne „piszkozat" szűrőre. Nem hibásnak látszó lista lenne,
   * hanem rossz sorokat tartalmazó.
   *
   * A szűrő azért létezhet mostantól, mert a tároló a legutolsó verziót
   * `DISTINCT ON`-nal választja ki (lásd `worksheetIdsByLatestStatus`).
   *
   * A NEVEK ITT A SZERVER MAI ÁLLAPOTAI, nem a felületé. A munka menete szerinti
   * elnevezés (Új, Folyamatban, Elkészült, Lezárva) még nem dőlt el, és amíg a
   * vitatott (alá nem írt) lap sorsa nyitott, a leképezés sem rögzíthető: egy
   * név, amit most írnánk ide, holnap mást jelentene, mint amit ígér.
   */
  @IsIn(WORKSHEET_VERSION_STATUSES)
  @IsOptional()
  status?: (typeof WORKSHEET_VERSION_STATUSES)[number];
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
  @IsString({ message: "Az aláíró nevét meg kell adni." })
  @MinLength(2, { message: "Az aláíró neve legalább két karakter legyen." })
  @MaxLength(200, {
    message: "Az aláíró neve legfeljebb 200 karakter lehet.",
  })
  signerName!: string;
  /**
   * Elfogadásnál megjegyzés, elutasításnál INDOK -- és akkor kötelező.
   *
   * A kötelezőséget a szolgáltatás mondja ki, nem ez a dekorátor-sor, mert a
   * szabály KÉT mezőt köt össze (a döntést és az indokot). Kipróbáltam
   * dekorátorral is: két `ValidateIf` ugyanazon a mezőn nem összeadódik, hanem
   * az utolsó felülírja az elsőt, tehát az elutasítás indok nélkül CSENDBEN
   * átment volna. Egy szabály, ami így néz ki, mintha érvényben lenne, rosszabb,
   * mint a hiánya.
   */
  @IsString({ message: "A megjegyzés csak szöveg lehet." })
  @MaxLength(1000, {
    message: "A megjegyzés legfeljebb 1000 karakter lehet.",
  })
  @IsOptional()
  note?: string | null;
}

export class CreateWorksheetDepartmentDto {
  /**
   * A SZULO HELYSZIN, ha van. Hianyzo ertek = a fa legfelso szintje.
   *
   * A szulo ellenorzese NEM itt tortenik: hogy a megadott azonosito UGYANAHHOZ
   * a partnerhez tartozik-e, csak az adatbazis tudja megmondani, es a
   * repository meg is kerdezi. Egy masik partner helyszine ala akasztott
   * alegyseg a munkalapszamot vinne rossz helyre.
   */
  @IsOptional()
  @IsString({ message: "A szülő helyszín azonosítója hibás." })
  parentId?: string;

  @Matches(/^[A-Za-z]{1,3}$/, {
    message: "Az alegység kódja legfeljebb három betű lehet (pl. BIO).",
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
