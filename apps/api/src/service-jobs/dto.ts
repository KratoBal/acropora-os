import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from "class-validator";

import { Transform } from "class-transformer";

import { optionalQueryBoolean } from "../common/query-boolean.util.js";
import {
  SERVICE_JOB_LIST_SCOPES,
  type ServiceJobListScope,
} from "./service-job-list-scope.js";

/**
 * A hibajegy felvitele.
 *
 * === A VEVŐ ÉS A HELYSZÍN KÖTELEZŐVÉ VÁLIK -- DE MÉG NEM ITT ===
 *
 * Balázs döntése, 2026-09-23 06:53 (Discord fő csatorna, üzenet
 * 1552181062837346325, szó szerint: „Kötelező"). A kérdés, amire válaszolt: a
 * helyszín kötelezővé tételéből következik, hogy a vevő is azzá válik, mert
 * helyszíne csak partnernek van. A partner nélküli belső jegy lehetősége
 * ezzel megszűnt.
 *
 * A `@IsOptional()` A `customerId`-N ÉS A `departmentId`-N MÉGIS ITT MARAD,
 * SZÁNDÉKOSAN: Balázs sorrendje szerint az API-szintű kikényszerítés (és a
 * `department_required` séma-migráció) a MOBIL KIADÁS UTÁN jön, nem előtte --
 * a mobil kliens (`uj-jegy-torzs.ts`) ma még a régi, opcionális szerződést
 * ismerő verzióban is kint van, és egy korábbi szigorítás pont azt a
 * szerelőt zárná ki, aki még nem frissített. Az ÚJ mobil kliens
 * (`uj-jegy-torzs.ts`, 2026-09-23-tól) már maga is megköveteli a partnert és
 * a helyszínt a gép nélküli úton -- ez az API-oldali tükre még hátravan.
 *
 * A LEZÁRT, RÉGI SZÖVEG, EMLÉKEZTETŐÜL: „A vevő elhagyható, mert a jegyet mi
 * is nyithatjuk olyasmire, ami még nem kötődik ügyfélhez." Ez a mondat innen
 * indult, és a döntés ezt az utat zárja le -- amint az enforcement ide is
 * megérkezik, ez a komment (és a két `@IsOptional()`) törlendő.
 */
export class CreateServiceJobDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsString() @MaxLength(4000) @IsOptional() description?: string | null;
  /**
   * A hibajegy a biztonságos alapértelmezés: a régi kliensek változatlanul
   * javítási munkát nyitnak. Karbantartási lapot az iroda nevezi meg
   * kifejezetten.
   */
  @IsIn(["REPAIR", "MAINTENANCE"])
  @IsOptional()
  kind?: "REPAIR" | "MAINTENANCE";
  /** Csak karbantartási munkához köthető keretszerződés. */
  @IsString() @IsOptional() contractId?: string | null;
  @IsString() @IsOptional() customerId?: string | null;
  /**
   * HONNAN NYITOTTAK A JEGYET -- ES EZ A TELEFON UTJA.
   *
   * A webes urlapon a partnert, a helyszint es az eszkozoket A SEMMIBOL kell
   * kivalasztani, ezert all ott harom valaszto. A helyszinen viszont a szerelo
   * EGY eszkoz elott all (beolvasta a matricajat, vagy a listabol nyitotta meg)
   * -- es abbol a harom mar KOVETKEZIK.
   *
   * A SZERVER VEZETI LE, NEM A KLIENS (acrobot dontese, 2026-09-16). Az
   * alternativa az lett volna, hogy a szallitoi eszkoz tukor-sorat beleirjuk az
   * eszkoz valaszaba -- de az a partner BELSO reszlete (a sema kommentje is ezt
   * mondja), es kliens-szerzodesse teve nem lehetne megvaltoztatni anelkul,
   * hogy a telefon elromoljon.
   *
   * AMIT FELULIR: semmit. Ha a hivo megadja a partnert vagy a helyszint, az
   * ové az elsobbseg -- ez a mezo csak azt potolja, ami hianyzik.
   */
  @IsString() @IsOptional() originAssetId?: string | null;
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
  /**
   * A HELYSZINI BEJELENTES IDEMPOTENCIA-KULCSA.
   *
   * A telefon terero nelkul SORBA teszi a jegyet, es a sor a halozati hibat
   * SZANDEKOSAN ujraprobalja. Epp ott lehet viszont, hogy a letrehozas MAR
   * lefutott, es csak a valasz veszett el -- kulcs nelkul az ujrakuldes MASODIK
   * jegyet nyitna ugyanarrol a hibarol.
   *
   * ELHAGYHATO: a webes urlap nem kuld kulcsot, es terero mellett a felvitel
   * nem is all sorba, tehat nincs mit ujrakuldeni.
   *
   * ES MIERT NEM ELEG A DTO: a mezo ONMAGABAN csak atengedne a kerest. A
   * vedelmet a `ServiceJob.clientOperationId` EGYEDI oszlopa adja, plusz a
   * letrehozas ket aga (elozetes kereses, es a unique-utkozes elkapasa).
   *
   * UGYANAZ AZ ALAK, MINT AZ ESZKOZNEL ES A MUNKALAPNAL, es ez szandekos: a
   * telefonon egy sor viszi mind a hármat, es harom kulonbozo minta abban a
   * sorban a legrosszabb hely.
   */
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;
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

/**
 * A JEGY HELYSZINE ES AZ OTT ALLO ESZKOZOK, EGYUTT, A FELVITEL UTAN.
 *
 * Balazs kerese, 2026-09-16: "Meglevo hibajegynel ugyanigy jo lenne ha hozza
 * lehetne adni eszkozt. illetve a helyszint is jo lenne ha leehtne modositani".
 *
 * === MIERT EGY DTO ES EGY VEGPONT, ES NEM KETTO ===
 *
 * Mert a felvitelen is EGY szabaly koti ossze oket: eszkozt csak helyszinnel
 * egyutt lehet megadni, es az eszkozoknek a helyszin RESZFAJAN kell allniuk.
 * Ket kulon vegpont ugyanazt a szabalyt ket helyen mondana ki, es
 * SORREND-FUGGOSEGET szulne: aki eloszor a helyszint valtja, annak a jegyen
 * allo eszkozok abban a pillanatban ervenytelenek; aki eloszor az eszkozt veszi
 * le, az elveszti oket akkor is, ha a helyszin-valtas utana elhasal.
 *
 * === AZ ESZKOZ-LISTA A TELJES HALMAZ, ES A MEZO KOTELEZO ===
 *
 * Ugyanaz az alak, mint a `SetServiceJobAssigneesDto`-nal, es ugyanabbol az
 * okbol: aki nincs rajta, lekerul, es egy elgepelt vagy kimaradt mezonek nem
 * szabad csendben leszedni mindent. Ures listat kuldeni SZABAD -- az kimondott
 * szandek.
 *
 * ES EZ EGYBEN A MEGEROSITES HELYE: helyszin-valtaskor a felulet megnevezi,
 * melyik eszkoz esne le az uj helyszin reszfajarol, es a felhasznalo dont. Az o
 * dontese IGY UTAZIK a keresben -- a szerver tehat soha nem tud leszedni olyat,
 * amit a felhasznalo nem latott.
 *
 * === A HELYSZIN NEM URITHETO ===
 *
 * A mezo kotelezo, es nem vesz fel `null` erteket. Egy ures helyszin az OSSZES
 * eszkozt leszedne a jegyrol, es erre nincs keres. Ami viszont van: a felvitelen
 * a helyszin ELHAGYHATO, tehat letezik helyszin NELKULI jegy -- azon ez a
 * vegpont az ELSO beallitast vegzi, es ott nincs leeso eszkoz.
 */
/**
 * A JEGY SZERKESZTHETO MEZOI, A FELVITEL UTAN.
 *
 * Balazs kerese, 2026-09-22: a hibajegy legyen modosithato. A HATART nem ez a
 * DTO hordozza, hanem a `descriptionEditBlocker` -- itt csak az ALAK all.
 *
 * === MIERT NEM A `SetServiceJobPlacementDto` BOVITESE ===
 *
 * Mert annak az `assetIds` mezoje KOTELEZO es TELJES HALMAZ (lasd ott, miert).
 * Ha a leiras oda kerulne, egy szovegmezo javitasahoz is el kellene kuldeni a
 * teljes eszkozlistat -- es ket kezelo eseten az, aki a leirast irja at,
 * VISSZAALLITANA egy eszkoz-valtoztatast egy mezon, amihez hozza sem nyult.
 * Ez nema adatvesztes, nem kenyelmetlenseg.
 *
 * === A MEZO ELHAGYHATO, ES `null`-T IS FELVESZ ===
 *
 * A ketto MAST jelent, es a kulonbseg szandekos: a hianyzo mezo azt mondja,
 * hogy NE NYULJ hozza; a `null` azt, hogy URITSD KI. A leiras a semaban
 * `String?`, tehat az urites ervenyes allapot.
 *
 * === A CIM IS ITT VAN, ES MAS SZABALYT VISEL, MINT A LEIRAS ===
 *
 * acrobot dontese, 2026-09-22, Balazs sajat peldaja alapjan, szo szerint:
 * „Most is van egy eles hibajegy aminek elirta a cimet. En se tudom
 * modositani". A „mindharom" valasza egy MASIK harmasra szolt (leiras,
 * helyszin, eszkozok), a peldaja viszont a CIMROL -- ha a cim kimaradna, pont
 * az a jegy maradna javithatatlan, ami miatt az egeszet kerte.
 *
 * A KULONBSEG: a cim `String` a semaban, NEM `String?`. Tehat elhagyhato
 * (=ne nyulj hozza), de `null`-t NEM vesz fel, es uresre sem irhato. A
 * `@MinLength(1)` a NYERS erteket nezi, tehat a csupa szokozt ATENGEDI -- a
 * trim utani uresseget ezert a szolgaltatas zarja, sajat mondattal.
 *
 * A HATAROK UGYANAZOK, mint a leirasnal: ugyanaz a `descriptionEditBlocker`,
 * ugyanaz a naplosor. Nem uj ut, egy mezovel tobb.
 */
export class UpdateServiceJobFieldsDto {
  /** A felvitel szabalyaval egyezoen (`CreateServiceJobDto`): 1..300. */
  @IsOptional()
  @IsString({ message: "A hibajegy címe szöveg legyen." })
  @MinLength(1, { message: "A hibajegy címét nem lehet üresen hagyni." })
  @MaxLength(300, {
    message: "A hibajegy címe legfeljebb 300 karakter lehet.",
  })
  title?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString({ message: "A hibajegy leírása szöveg legyen." })
  @MaxLength(4000, {
    message: "A hibajegy leírása legfeljebb 4000 karakter lehet.",
  })
  description?: string | null;
}

export class SetServiceJobPlacementDto {
  @IsString() @MinLength(1) @MaxLength(64) departmentId!: string;
  /**
   * UGYANAZ A FELSO HATAR, mint a felvitelen (`ArrayMaxSize(50)`): ket
   * kulonbozo hatar ugyanarra a listara csak azt jelentene, hogy az egyiket
   * elfelejtettuk karbantartani.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  assetIds!: string[];
  /**
   * A FELHASZNALO TUDOMASUL VETTE, HOGY A KOTOTT LAPOKON MARAD OLYAN ESZKOZ,
   * AMI AZ UJ HELYSZINEN KIVUL ALL.
   *
   * MIERT KAPCSOLO, ES MIERT NEM LISTA: a jegy sajat eszkozeinel a megerosites
   * MAGA A LISTA -- ott a felhasznalo azt kuldi vissza, amit meghagyott. Itt
   * nincs mit visszakuldeni: az eszkozok a LAPON MARADNAK (acrobot dontese,
   * 2026-09-16), tehat a felhasznalo nem valogat, hanem TUDOMASUL VESZ.
   *
   * ELHAGYHATO, ES HAMIS AZ ALAPERTELMEZES: aki nem kuldi, az nem mondott
   * igent. A szerver ilyenkor MEGNEVEZI, melyik lapon melyik eszkoz esne kivul
   * es hol all ma -- es csak a masodik, kimondott korben ir.
   *
   * ES CSAK AKKOR SZAMIT, HA VAN UTKOZES. Ha egyetlen eszkoz sem esne kivul (ez
   * a gyakori eset), a valtas ugyanugy megy at, mint eddig: a megallas az
   * UTKOZESRE szol, nem a muveletre.
   */
  @IsBoolean()
  @IsOptional()
  acceptWorksheetAssetsOutsideSite?: boolean;
}

/**
 * A HATOKOROK LISTAJA EGY HELYEN ALL, es az a `service-job-list-scope.ts`.
 *
 * Nem kenyelem: ugyanaz a felsorolas donti el, mit FOGAD EL a vegpont (itt) es
 * mit JELENT a hatokor (ott). Ket masolatbol az egyik elobb-utobb bovul, es a
 * kulonbseg NEMA: egy uj ertek vagy 400-at kapna egy mukodo szurore, vagy
 * atmenne ugy, hogy a lekerdezes nem tud vele mit kezdeni.
 */

/**
 * A lista alapból csak a NYITOTT jegyeket adja.
 *
 * Nem kényelem: egy hibajegy-lista, ami a lezártakat is hozza, az első
 * hónap után használhatatlan - a napi munkában az számít, ami MÉG nyitva van.
 * A teljes lista külön kérésre jön.
 *
 * A TELEFON 2026-09-17 OTA MAST KULD: ott az `osszes` az alapertelmezes (Balazs
 * kerese), es a kepernyo ezt KIIRJA magabol. A szerveren azert marad az `open`,
 * mert a kerese a MOBIL alkalmazasra szolt -- itt atallitva a WEBES lista is
 * elmozdulna, amirol senki nem kert semmit.
 */
export class ServiceJobListQueryDto {
  @IsIn(["REPAIR", "MAINTENANCE"])
  @IsOptional()
  kind?: "REPAIR" | "MAINTENANCE";

  @IsIn(SERVICE_JOB_LIST_SCOPES)
  @IsOptional()
  scope?: ServiceJobListScope;

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

  /**
   * A REJTETT JEGYEK IS JÖJJENEK. Alapból nem jönnek.
   *
   * Ugyanaz a mező és ugyanaz a szabály, mint a munkalap-listán: a kapcsoló
   * KÉRÉS, nem engedély. Hogy hat-e, azt a hatókör dönti el
   * (`hiddenRowsWhere`), nem a hívó -- a partner portálján a rejtett sor soha
   * nem értelmezett.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
  @IsBoolean()
  includeHidden?: boolean;
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

/**
 * A REJTES JELOLOJE -- ES KOTELEZO, NEM ELHAGYHATO.
 *
 * Ugyanaz az indok, mint a munkalapnal: egy ures torzsu keres CSENDBEN az
 * egyik iranyt valasztana, es a hivo azt hinne, a masikat kerte.
 */
export class SetServiceJobHiddenDto {
  @IsBoolean({ message: "A rejtés jelölése csak igen vagy nem lehet." })
  hidden!: boolean;
}
