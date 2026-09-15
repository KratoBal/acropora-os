import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

/**
 * A hibajegy felvitele.
 *
 * A CÍM AZ EGYETLEN KÖTELEZŐ MEZŐ, és ez tudatos: egy jegy attól jegy, hogy
 * megnevezi, mi a baj. A vevő elhagyható, mert a jegyet mi is nyithatjuk
 * olyasmire, ami még nem kötődik ügyfélhez.
 */
export class CreateServiceJobDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsString() @MaxLength(4000) @IsOptional() description?: string | null;
  @IsString() @IsOptional() customerId?: string | null;
  /**
   * HOL VAN A BAJ: a partner helyszine, ugyanabbol a fabol, amit a munkalap es
   * az eszkoz hasznal.
   *
   * ELHAGYHATO, DE NEM SZABADON: ha meg van adva, a szerver ELLENORZI, hogy a
   * helyszin a megadott partnere-e. Enelkul egy elgepelt vagy atmasolt
   * azonosito MAS partner egysegere akasztana ra a jegyet, es a felulet ezt
   * soha nem mutatna meg -- a lista a sajat partnere egysegeit rajzolja, tehat
   * egy idegen egyseg ott egyszeruen URESKENT jelenne meg.
   */
  @IsString() @IsOptional() departmentId?: string | null;
  /**
   * A HELYSZINEN ALLO ESZKOZOK, AMIKROL A JEGY SZOL. Tobb is lehet.
   *
   * Balazs kerese, 2026-09-14: "a partner helyszinehez kapcsolod eszkozok kozul
   * lehessen kivalasztani, akar tobbet is."
   *
   * CSAK HELYSZINNEL EGYUTT ERVENYES, es ez nem technikai kenyszer: a kert
   * halmaz maga a HELYSZIN eszkozeibol all. Helyszin nelkul a partner OSSZES
   * eszkoze jonne szoba, amibol a bejelento nem tud valasztani -- es a szerver
   * sem tudna megmondani, melyik tartozik a bejelenteshez.
   *
   * A RESZFA SZAMIT, NEM A PONTOS EGYEZES: az eszkoz a fa barmelyik
   * csomopontjahoz kotheto, tehat a "Biodom" alatti medencen logo eszkoz IS a
   * Biodom eszkoze. A pontos egyezes itt nema hibat adna.
   */
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @IsOptional()
  assetIds?: string[];
  /**
   * A DELEGÁLT KOLLÉGÁK MÁR A FELVITELKOR, opcionálisan.
   *
   * Az iroda nyitja a jegyet a szervizesnek: a delegálás abban a pillanatban
   * ismert, amikor a jegy megszületik. Külön lépésre bízva a felvivő azt hiszi,
   * kiadta a munkát, közben a jegy senki listáján nem jelenik meg -- és erről
   * semmi nem szól, mert a delegálatlan jegy nem hibás állapot.
   *
   * A mező LISTÁT vesz át, nem egyetlen azonosítót. Balázs kérése többes
   * számban szól („a szervizes kollegakat"), és egy felvitelkori „csak egyet
   * lehet" később kivehetetlen szűkítés lenne.
   *
   * UGYANAZ A KORLÁT, mint a külön végponton (`ArrayMaxSize(20)`): két
   * különböző határ ugyanarra a listára csak azt jelentené, hogy az egyiket
   * elfelejtettük karbantartani.
   */
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsOptional()
  assigneeIds?: string[];
}

/**
 * A JEGYRE DELEGÁLT KOLLÉGÁK TELJES LISTÁJA.
 *
 * A beküldött lista a jegy TELJES névsora: aki nincs rajta, lekerül. Nem
 * hozzáadás, mert egy „vedd le X-et" művelethez a felületnek tudnia kellene,
 * ki van fent -- és akkor is a teljes listát küldi, csak eggyel kevesebbet.
 *
 * A mező KÖTELEZŐ, alapértelmezett üres lista nélkül: egy elgépelt vagy
 * kimaradt mezőnek nem szabad csendben leszedni mindenkit a jegyről. Üres
 * listát küldeni viszont szabad -- az kimondott szándék.
 */
export class SetServiceJobAssigneesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  userIds!: string[];
}

export const SERVICE_JOB_LIST_SCOPES = ["open", "all"] as const;

/**
 * A lista alapból csak a NYITOTT jegyeket adja.
 *
 * Nem kényelem: egy hibajegy-lista, ami a lezártakat is hozza, az első
 * hónap után használhatatlan - a napi munkában az számít, ami MÉG nyitva van.
 * A teljes lista külön kérésre jön.
 */
export class ServiceJobListQueryDto {
  @IsIn(SERVICE_JOB_LIST_SCOPES)
  @IsOptional()
  scope?: (typeof SERVICE_JOB_LIST_SCOPES)[number];

  /**
   * SZABAD SZAVAS KERESES, A SZERVEREN.
   *
   * A MUNKALAP-LISTA MAR IGY MUKODIK (worksheets.repository.ts), es ugyanaz a
   * minta all itt: harom mezo `OR`-ban, kis-nagybetutol fuggetlenul. A
   * hibajegy-lista eddig CSAK `scope`-ot ismert -- es egy kliensoldali kereso
   * azt igerne, hogy az egesz halmazban keres, holott csak a visszaadott
   * ketszaz soron. Ezert nem rajzoltuk ki a mezot addig, amig ez nem volt meg.
   *
   * AMIT EZ NEM KEZEL, ES KI KELL MONDANI: az EKEZETET. A `contains` +
   * `insensitive` ILIKE-ra fordul, tehat a "szivattyu" nem talalja meg a
   * "szivattyú"-t. Az adatbazisban VAN `unaccent` kiterjesztes (a
   * 20260828124000 migracio tette fel a termek-keresohoz), de azt ez az ut nem
   * hasznalja -- ahhoz sajat oszlop vagy nyers SQL kellene. Ma tehat a kereses
   * kis-nagybetuben elnezo, ekezetben szigoru, es ez a munkalap-listaval
   * AZONOS viselkedes: ket szerviz-lista, egy szabaly.
   */
  @IsString()
  @IsOptional()
  search?: string;
}

/**
 * Egy lépés a hibajegyen.
 *
 * A `note` elhagyható, de a felület kérheti: hogy egy jegy MIÉRT vár
 * alkatrészre, azt csak az tudja, aki odalépteti - és két hét múlva már senki.
 */
export class MoveServiceJobDto {
  @IsIn([
    "NEW",
    "TRIAGED",
    "SCHEDULED",
    "IN_PROGRESS",
    "WAITING_FOR_PARTS",
    "WAITING_FOR_CUSTOMER",
    "COMPLETED",
    "CANCELLED",
  ])
  to!:
    | "NEW"
    | "TRIAGED"
    | "SCHEDULED"
    | "IN_PROGRESS"
    | "WAITING_FOR_PARTS"
    | "WAITING_FOR_CUSTOMER"
    | "COMPLETED"
    | "CANCELLED";

  @IsString() @MaxLength(2000) @IsOptional() note?: string | null;
}

/**
 * Egy meglevo munkalap a jegy ala.
 *
 * CSAK AZ AZONOSITO: a csatolas nem valtoztat semmit a lapon azon kivul, hogy
 * melyik jegy alatt all. Barmi mas mezo itt azt sugallna, hogy a csatolas
 * kozben a lapot is szerkesztjuk.
 */
export class AttachWorksheetDto {
  @IsString() @MaxLength(64) worksheetId!: string;
}

/**
 * Partner egy meg partner nelkuli jegyre.
 *
 * CSAK AZ AZONOSITO: a beallitas nem valtoztat semmi mast a jegyen. Barmi mas
 * mezo itt azt sugallna, hogy kozben a jegyet is szerkesztjuk.
 */
export class SetServiceJobPartnerDto {
  @IsString() @MaxLength(64) customerId!: string;
}

/**
 * EGY ALEGYSEG HOZZARENDELESE EGY FELHASZNALOHOZ.
 *
 * CSAK AZ AZONOSITO: a hozzarendeles nem valtoztat semmi mast. Barmi tovabbi
 * mezo azt sugallna, hogy kozben a felhasznalot is szerkesztjuk.
 */
export class AssignVisibilityUnitDto {
  @IsString() @MaxLength(64) departmentId!: string;
}
