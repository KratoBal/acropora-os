import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  /**
   * AZ ÁR ELHAGYHATÓ, ÉS A HIÁNY NEM NULLA.
   *
   * A szerelő a helyszínen azt rögzíti, mit csinált és mennyit; az árat az
   * iroda adja meg (Balázs döntése, 2026-09-02). Egy kötelező mező mellett a
   * telefonnak találomra kellene értéket küldenie, és a kézenfekvő nulla a
   * lapon ÉRTÉKKÉNT állna: aki ránéz, nem tudja megkülönböztetni az ingyenes
   * munkától.
   *
   * A HIÁNY NEM MARAD ÉSZREVÉTLEN: ár nélküli tétellel a lap nem zárható le.
   */
  @IsNumber({ maxDecimalPlaces: 4 }) @IsOptional() unitNet?: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @IsOptional()
  vatRatePercent?: number;
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
  // első tagja és a lapon látható egység elcsúszhatna egymástól, pedig
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

/**
 * MELYIK JEGYHEZ KERUNK CSATOLHATO LAPOKAT.
 *
 * A `customerId` KOTELEZO, es ez a dontes fele. Elhagyhato mezovel a hivas a
 * regi, SZURETLEN listat adna vissza -- vagyis a mai hiba tovabb elne, csendben,
 * minden hivonal, aki elfelejti atadni. Kotelezokent a szuretlen lista elo sem
 * all: aki nem adja meg, hibat kap.
 *
 * A ket tevedes ara nem egyforma: egy hianyzo parameter HANGOS (a hivas
 * elhasal), egy szuretlen lista NEMA (a felulet felkinal valamit, amit a
 * vegpont utana visszautasit).
 */
export class AttachableWorksheetQueryDto {
  @IsString() @MinLength(1) customerId!: string;
}

export class CreateWorksheetDto extends WorksheetContentDto {
  /**
   * A KLIENS ALTAL ADOTT MUVELET-AZONOSITO, A HELYSZINI ROGZITES
   * IDEMPOTENCIA-KULCSA.
   *
   * ELHAGYHATO, ES EZ KIKOTES: a webes felvitel nem kuld kulcsot, es MA
   * MUKODIK. Kotelezove teve az urlapot is at kellene irni.
   *
   * UGYANAZ AZ ALAK, MINT AZ ESZKOZNEL (`CreateAssetDto`), es ez szandekos: a
   * telefonon EGY sor viszi mind a kettot, es ket kulonbozo minta abban a
   * sorban a legrosszabb hely. Megengedobb, mint a SOR-azonositoe, mert a mai
   * kliens-kulcs kettospontot es pontot is tartalmaz.
   */
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;
  @IsString() @MinLength(1) customerId!: string;
  @IsString() @MinLength(1) departmentId!: string;
  /**
   * A HIBAJEGY, AMI ALA A LAP KERUL -- ELHAGYHATOAN, ES EGY TRANZAKCIOBAN.
   *
   * ELHAGYHATO, mert a lap KELETKEZHET jegy nelkul: karbantartas kozben derul
   * ki, hogy valami elromlott, a szerelo ott helyben felveszi a lapot, es a
   * hibajegy nalunk szuletik meg utolag. Ez nem kivetel, hanem az egyik rendes
   * ut (a sema jegyzete is ezt mondja).
   *
   * ES MIERT ITT, NEM KET HIVASBAN: ket lepesben a masodik fele elbukhat
   * (halozat, jogosultsag, elgepelt azonosito), es epp az a JEGY NELKULI lap
   * keletkezne, amit a felhasznalo nem is keresne ott. A `create` metodus
   * kommentje ugyanezt az esetet keruli el a felelosoknel -- ez a mezo a haz
   * sajat precedenset koveti, nem uj dontes.
   */
  @IsString() @IsOptional() serviceJobId?: string | null;
  /**
   * A felelősök MÁR A FELVITELKOR, opcionálisan.
   *
   * Ugyanaz a szabály, mint a `SetWorksheetAssigneesDto` esetén: a beküldött
   * lista a lap TELJES felelős-listája. Felvitelkor ez a kettő egybeesik, de a
   * mező itt is listát vesz át, nem egyetlen azonosítót -- egy laphoz több
   * szerelő is tartozhat, és a felvitelkori „csak egyet lehet" később
   * kivehetetlen szűkítés lenne.
   */
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  assigneeIds?: string[];
}

export class UpdateWorksheetDraftDto extends WorksheetContentDto {}

export class AmendWorksheetDto extends WorksheetContentDto {
  /** Az indoklás kötelező: enélkül a napló nem mond semmit arról, miért módosult egy kiadott dokumentum. */
  @IsString() @MinLength(3) @MaxLength(1000) changeReason!: string;
}

/**
 * EGY MUNKANAPLO-BEJEGYZES SZOVEGE.
 *
 * A felso hatar 4000 karakter, ugyanaz, mint a munkalap leirasa
 * (`WorksheetContentDto.description`). Nem talalt szam: ha egy szerelo egy
 * napi munkat le tud irni abban a mezoben, egy bejegyzes sem kivan tobbet.
 *
 * AZ ALSO HATAR 1, ES A LEVAGOTT HOSSZ SZAMIT: a csupa szokozbol allo bejegyzes
 * pontosan annyit mond, mint a hianyzo, viszont sort foglal a listan es
 * szerzot meg idopontot kap -- ugy nezne ki, mintha valaki dolgozott volna.
 */
export class WorksheetEntryBodyDto {
  @IsString()
  @MinLength(1, { message: "Írd le, mit csináltál." })
  @MaxLength(4000, {
    message: "A bejegyzés legfeljebb 4000 karakter lehet.",
  })
  body!: string;
}

export class CreateWorksheetEntryDto extends WorksheetEntryBodyDto {}
export class UpdateWorksheetEntryDto extends WorksheetEntryBodyDto {}

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
 * Egy meglévő alegység szerkesztése: NÉV és ARCHIVÁLÁS, semmi más.
 *
 * A tulajdonos döntése (Balázs, 2026-09-02 20:29, Discord): „csak a nevet
 * lehessen átírni menjen az archiválással".
 *
 * A `code` és a `parentId` SZÁNDÉKOSAN nincs itt, és a hiányuk nem passzív: a
 * globális `ValidationPipe` `forbidNonWhitelisted` beállítással fut, tehát egy
 * `code` mezőt tartalmazó kérés 400-zal elhasal, nem csendben lehullik. Aki
 * ezt a végpontot bővíti, előbb ezt a bekezdést írja át.
 *
 * A név szabályai UGYANAZOK, mint felvitelkor. Külön indok nélkül eltérni
 * annyit tenne, hogy egy név, amit létrehozni nem lehet, átnevezéssel mégis
 * előállítható.
 */
export class UpdateWorksheetDepartmentDto {
  @IsOptional()
  @IsString({ message: "Az alegység nevét meg kell adni." })
  @MinLength(2, { message: "Az alegység neve legalább két karakter legyen." })
  @MaxLength(200, {
    message: "Az alegység neve legfeljebb 200 karakter lehet.",
  })
  name?: string;

  @IsOptional()
  @IsBoolean({ message: "Az aktív jelölés csak igen vagy nem lehet." })
  isActive?: boolean;
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

/**
 * HANY FAJL MEHET EGY KERESBEN.
 *
 * UGYANAZ A SZAM, MINT AZ ESZKOZNEL (tiz), es szandekosan: a ket felulet
 * ugyanazt a kotetet es ugyanazt a keretet hasznalja, tehat ket kulonbozo
 * hatar csak azt jelentene, hogy az egyiket elfelejtettuk karbantartani.
 */
export const MAX_WORKSHEET_DOCUMENTS_PER_UPLOAD = 10;

const WORKSHEET_DOCUMENT_TYPES = ["PHOTO", "OTHER"] as const;

export class UploadWorksheetDocumentDto {
  /**
   * A CSATOLMANY FAJTAJA. ELHAGYHATO, es az alapertelmezes a `PHOTO`: a
   * telefonrol erkezo feltoltes MINDIG fenykep, es egy kotelezo mezo ott csak
   * egy allando literal lenne a kliensben.
   */
  @IsIn(WORKSHEET_DOCUMENT_TYPES)
  @IsOptional()
  type?: (typeof WORKSHEET_DOCUMENT_TYPES)[number];
}
