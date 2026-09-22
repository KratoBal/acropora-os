import type { WorksheetLineKind } from "@acropora/database";
import { Transform, Type } from "class-transformer";
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
  ValidateIf,
  ValidateNested,
} from "class-validator";

import { optionalQueryBoolean } from "../../common/query-boolean.util.js";
import { DOCUMENT_CAPTION_MAX_LENGTH } from "../../documents/document-caption.js";

export const WORKSHEET_VERSION_STATUSES = [
  "DRAFT",
  "AWAITING_SIGNATURE",
  "SIGNED",
  "REJECTED",
] as const;

export const WORKSHEET_SIGNATURE_DECISIONS = ["ACCEPTED", "REJECTED"] as const;

/**
 * A TÉTEL-FAJTÁK, A SÉMÁHOZ KÖTVE -- ÉS A KÖTÉS ALAKJA MÉRVE VAN.
 *
 * Az első változatom `as const satisfies readonly WorksheetLineKind[]` volt, és
 * az NEM VÉD: lemértem, egy érték KIVÉTELE után a typecheck ZÖLD MARADT. A
 * `readonly T[]` csak azt kéri, hogy minden elem a típus TAGJA legyen -- azt
 * nem, hogy minden tag szerepeljen. A komment, ami mellette állt, hamis
 * védelmet ígért.
 *
 * A `Record<WorksheetLineKind, true>` ezt zárja le: MINDEN enum-értéknek
 * kulcsként ott kell állnia. Ha a séma egy harmadik értéket kap (például
 * MATERIAL), ez a sor fordítási hibát ad -- és ezt is lemértem, mindkét
 * irányban.
 */
const LINE_KIND_SET = {
  LABOR: true,
  OTHER: true,
} as const satisfies Record<WorksheetLineKind, true>;

export const WORKSHEET_LINE_KINDS = Object.keys(
  LINE_KIND_SET,
) as WorksheetLineKind[];

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

  /**
   * A REJTETT LAPOK IS JÖJJENEK. Alapból nem jönnek.
   *
   * A KAPCSOLÓ A BELSŐ ÚTON ÉRTELMEZETT, ÉS EZT NEM ITT DÖNTJÜK EL, hanem a
   * `hiddenRowsWhere` a hatókörből. Egy kérés-paramétert a partner portálja is
   * megadhat; ha a hívó döntené el, a próbasorok pont ott jelennének meg, ahol
   * a legrosszabb. Ez a mező tehát KÉRÉS, nem engedély.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => optionalQueryBoolean(value))
  @IsBoolean()
  includeHidden?: boolean;
}

export class WorksheetLineDto {
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @IsString() @MaxLength(500) @IsOptional() detail?: string | null;
  @IsString() @IsOptional() assetId?: string | null;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) quantity!: number;
  @IsString() @MinLength(1) @MaxLength(20) unit!: string;
  /**
   * A TÉTEL FAJTÁJA. Ez dönti el, beleszámít-e az összesített munkaórába --
   * NEM a `unit` szövege, mert az szabad szöveg, és egy elgépelt "ora" csendben
   * kimaradna az összegből.
   *
   * ELHAGYHATÓ, és a hiánya `OTHER`: a mai hívók (telefon és web) nem küldik,
   * és a séma alapértelmezése ugyanez. Aki munkát rögzít, kimondja.
   */
  @IsIn(WORKSHEET_LINE_KINDS) @IsOptional() kind?: WorksheetLineKind;
  /**
   * HÁNYAN DOLGOZTAK A TÉTELEN. A tétel munkaórája: `quantity * workerCount`.
   *
   * `@Min(1)`: a nulla azt jelentené, hogy a tétel némán kiesik az összegből.
   * Elhagyható, és a hiánya EGY -- ez a séma alapértelmezése is, tehát a mai
   * hívók változatlanul küldhetnek nélküle tételt.
   */
  @IsInt() @Min(1) @Max(999) @IsOptional() workerCount?: number;
  /**
   * AZ ÁR ELHAGYHATÓ, ÉS A HIÁNY NEM NULLA.
   *
   * A szerelő a helyszínen azt rögzíti, mit csinált és mennyit; az árat az
   * iroda adja meg (Balázs döntése, 2026-09-02). Egy kötelező mező mellett a
   * telefonnak találomra kellene értéket küldenie, és a kézenfekvő nulla a
   * lapon ÉRTÉKKÉNT állna: aki ránéz, nem tudja megkülönböztetni az ingyenes
   * munkától.
   *
   * A HIÁNY 2026-09-17 ÓTA NEM AKADÁLY: Balázs döntése szerint az ár sehol
   * nem jelenik meg, és ezért a lezárási feltétel is kikerült. Az adat
   * megmarad, ár továbbra is rendelhető -- csak a hiánya nem állít meg semmit.
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
  /**
   * A LAP ALTAL ERINTETT ESZKOZOK, MAR A FELVITELKOR.
   *
   * Balazs kerese (2026-09-15): a hibajegynel kivalasztott eszkozok jelenjenek
   * meg a belole nyitott lapon is. A jegybol nyitott lap ezekkel INDUL -- de a
   * mezo nem a jegyhez kot: egy jegy nelkuli lapra is fel lehet venni oket.
   *
   * ELHAGYHATO, es ez nem lazasag: a lap keletkezhet eszkoz megnevezese nelkul
   * (karbantartas kozben felvett lap), es egy kotelezo mezo epp azt az utat
   * nehezitene.
   *
   * UGYANAZ A KORLAT, mint a jegy oldalan (`ArrayMaxSize(50)`): ket kulonbozo
   * hatar ugyanarra a listara csak azt jelentene, hogy az egyiket elfelejtettuk
   * karbantartani.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @IsOptional()
  assetIds?: string[];
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
  /**
   * AZ ALAIRO NEVE, HA A HIVO IRTA BE ("egyik sem" ag).
   *
   * ELHAGYHATOVA VALT 2026-09-04-en, es a kotelezoseget a SZOLGALTATAS mondja
   * ki, nem ez a dekorator-sor: a szabaly KET mezot kot ossze (ha nincs
   * `signerUserId`, akkor a nev kotelezo). Ugyanaz a megfontolas, mint az
   * elutasitas indokanal -- ket `ValidateIf` ugyanazon a mezon nem osszeadodik,
   * hanem felulirja egymast, es a hianyzo nev CSENDBEN atmenne.
   *
   * ES HA VAN `signerUserId`, EZT A MEZOT A SZERVER FIGYELMEN KIVUL HAGYJA: a
   * nevet a valasztott felhasznalo soraból veszi. Egy klienstol jovo nev
   * ilyenkor azt jelentene, hogy a lapra MAS nev kerul, mint akit valasztottak.
   */
  @IsString({ message: "Az aláíró nevét meg kell adni." })
  @MinLength(2, { message: "Az aláíró neve legalább két karakter legyen." })
  @MaxLength(200, {
    message: "Az aláíró neve legfeljebb 200 karakter lehet.",
  })
  @IsOptional()
  signerName?: string;
  /**
   * KIT VALASZTOTT A SZERELO a lap partnerenek munkatarsai kozul.
   *
   * A jelenlete donti el, MELYIK agon ment az alairas -- a szerver ebbol
   * szamolja a `signerSource` erteket, nem a klienstol kerdezi. Egy
   * klienstol jovo "forras" mezo ellentmondhatna a valasztott szemelynek, es
   * akkor a lapon egy hamis jelzes allna.
   */
  /**
   * A SAJÁT KOLLÉGÁNK ÍRJA ALÁ, AZONOSÍTVA.
   *
   * Balázs kérése, 2026-09-18 07:01 UTC: „Es az elozo kepernyon utolso gomb
   * Alairom."
   *
   * === A KLIENS NEM KÜLD AZONOSÍTÓT, ÉS EZ A MEZŐ LÉNYEGE ===
   *
   * Csak annyit mond, hogy a HITELESÍTETT AKTOR írja alá; a szerver onnan veszi
   * a személyt. Így nincs mit hamisítani a kérés törzsében. Ha a kliens
   * választhatna aláírót, ez a mező nevesítve adna át egy hatalmat, amit ma
   * senki nem kapott meg.
   *
   * === ALÁÍRÓKÓD NINCS EZEN AZ ÁGON (acrobot döntése, 2026-09-18 13:22) ===
   *
   * Ugyanaz az ember ugyanezzel a bejelentkezéssel lezárja a lapot, átírja a
   * tételeket és rejt is. Egyik sem kér második titkot; egy második titok
   * KIZÁRÓLAG itt azt állítaná, hogy ez a lépés erősebben védett, mint a többi.
   *
   * A PARTNER-ÁGON VISZONT MARAD, és nem ugyanazért: ott a telefon a MI
   * szerelőnk kezében van, és a kód azt bizonyítja, hogy a PARTNER embere volt
   * ott. Két különböző kérdés, két különböző válasz.
   */
  @IsBoolean({ message: "A saját aláírás jelölése csak igen vagy nem lehet." })
  @IsOptional()
  signSelf?: boolean;
  @IsString() @IsOptional() signerUserId?: string;
  /**
   * AZ ALAIROKOD, amit az UGYFEL ir be. CSAK a listarol valasztott agon kell.
   *
   * A kotelezoseget a SZOLGALTATAS mondja ki, nem ez a dekorator-sor: a szabaly
   * KET mezot kot ossze (ha van `signerUserId`, akkor a kod kotelezo). Ugyanaz
   * a megfontolas, mint az elutasitas indokanal.
   *
   * NEM `@MinLength(4)`: az alakot a `worksheet-signing-code.ts` ellenorzi,
   * mert ott MERHETO, es mert a harom bukasi mod HAROM KULON mondatot kap --
   * egy dekorator-uzenet mind a haromra ugyanazt mondana.
   */
  @IsString() @IsOptional() signatureCode?: string;
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

  /**
   * A BEMENET SZÁNDÉKOSAN MEGENGEDŐBB A TÁROLT ALAKNÁL, ÉS EZ NEM HANYAGSÁG.
   *
   * A tárolt alak nagybetűs (`WORKSHEET_DEPARTMENT_CODE_PATTERN`, és az
   * adatbázis CHECK-je is), a normalizálás pedig a repositoryban történik
   * (`worksheets.repository.ts`, `code.trim().toUpperCase()`). Ide azért
   * kerül kisbetű is, mert a boltban gépelő kolléga kisbetűvel ír, és egy
   * hálózati kör után visszadobni azért, amit egy `toUpperCase()` megold,
   * csak bosszantás.
   *
   * A SZÁMJEGY 2026-09-22-én került be, Balázs kérésére. A számjegynek nincs
   * kis- és nagybetűje, tehát a normalizálás változatlanul helyes marad rá.
   */
  @Matches(/^[A-Za-z0-9]{1,3}$/, {
    message:
      "Az alegység kódja legfeljebb három betű vagy szám lehet (pl. BIO vagy A1).",
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

/**
 * A LAP ESZKOZEI, TELJES LISTAKENT.
 *
 * Balazs kerese, 2026-09-16: "munkalapnal is jo lenne ha lehetne a helyszinhez
 * rogzitett eszkozoket csatolni".
 *
 * `PUT`, ES A BEKULDOTT LISTA A TELJES ALLAPOT, nem hozzaadas -- ugyanaz az
 * alak, mint a felelosoknel, es ugyanabbol az okbol: egy "vedd le X-et"
 * muvelethez a feluletnek ugyis tudnia kellene, mi all fent, es akkor is a
 * teljes listat kuldene, csak eggyel kevesebbet.
 *
 * A MEZO KOTELEZO, alapertelmezett ures lista nelkul: egy elgepelt vagy
 * kimaradt mezonek nem szabad csendben leszedni mindent. Ures listat kuldeni
 * viszont SZABAD -- az kimondott szandek.
 *
 * A HELYSZIN NEM SZEREPEL ITT, ES EZ ELTER A HIBAJEGYTOL: a lap helyszine a
 * FELVITELKOR dol el es utana nem valtozik, tehat nincs mihez kepest elcsuszni.
 * A szerver a lap SAJAT helyszinere ellenoriz.
 */
export class SetWorksheetAssetsDto {
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  assetIds!: string[];
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

  /**
   * A FELIRAT MAR A FELTOLTESKOR MEGADHATO.
   *
   * EGY KERESRE EGY FELIRAT: a vegpont egyszerre tiz fajlt fogad, es ez az egy
   * szoveg MINDEGYIKRE rakerul. Aki kepenkent mast ir, a szerkeszto uton teszi
   * (`PATCH`), vagy egyesevel tolt fel. A fajlonkenti, tomb-alaku felirat
   * SZANDEKOSAN nem szerepel: a multipart mezok sorrendje nem garantalja az
   * igazitast a fajlokhoz, es egy elcsuszott felirat NEM hibazna -- csak rossz
   * kepre kerulne.
   */
  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  @IsOptional()
  caption?: string;
}

/**
 * A FELIRAT UTOLAGOS ATIRASA EGY MUNKALAP-CSATOLMANYON.
 *
 * A HIANYZO MEZO ES A `null` UGYANAZT JELENTI: toroljem a feliratot. Ez a
 * vegpont EGY mezot ir, tehat nincs mit megkulonboztetni -- a `ValidateIf`
 * ezert engedi at mind a kettot, es a szoveg-ellenorzes csak akkor fut, ha van
 * szoveg.
 */
export class UpdateWorksheetDocumentCaptionDto {
  @ValidateIf((_, ertek) => ertek !== null && ertek !== undefined)
  @IsString()
  @MaxLength(DOCUMENT_CAPTION_MAX_LENGTH)
  caption?: string | null;
}

/**
 * A REJTES JELOLOJE -- ES KOTELEZO, NEM ELHAGYHATO.
 *
 * Ha elhagyhato lenne, egy ures torzsu keres CSENDBEN az egyik iranyt
 * valasztana (amelyik az alapertelmezes), es a hivo azt hinne, a masikat
 * kerte. Egy rejtes, ami veletlenul visszaallitas, pontosan olyan nema, mint
 * a forditottja.
 */
export class SetWorksheetHiddenDto {
  @IsBoolean({ message: "A rejtés jelölése csak igen vagy nem lehet." })
  hidden!: boolean;
}

/**
 * AZ ATADAS JELOLESE -- EGY UT, TORZSBEN KAPOTT JELOLOVEL.
 *
 * UGYANAZ AZ ALAK, MINT A REJTESNEL, ES AZ INDOK IS UGYANAZ: a felulet ne
 * talalgasson. Ha a jelolo a torzsben all, a gomb MEGMONDJA, melyik iranyba
 * megy, es ket egymast koveto kattintas nem fordit oda-vissza egy allapotot,
 * amit kozben valaki mas is allithatott.
 *
 * A VISSZAVONAS TUDATOSAN BENNE VAN, es a ket tevedes ara nem egyforma:
 * egy TEVEDESBOL bejelolt atadas engedne lezarni a jegyet, holott az eszkoz
 * meg nalunk van -- ez NEMA. Egy tevedesbol visszavont atadas megallitja a
 * lezarast -- ez HANGOS, valaki azonnal szol. A visszavonhatatlan alak tehat
 * a nemabb hibat teszi javithatatlanna.
 */
export class SetWorksheetHandedOverDto {
  @IsBoolean({ message: "Az átadás jelölése csak igen vagy nem lehet." })
  handedOver!: boolean;
}

/**
 * KIKULDES ALAIRASRA -- A CIMZETT KOTELEZO.
 *
 * NEM ELHAGYHATO, es ez nem szigorusag: a lap tetejen meg kell jelennie, KINEK
 * kuldtuk el (Balazs dontese, 2026-09-21 14:00:58). Egy cimzett nelkuli
 * kikuldes olyan allapotot hozna letre, amirol a felulet nem tud mit mondani --
 * "elkuldve, de nem tudjuk kinek" --, es az rosszabb, mint a mai semmi.
 *
 * A HALMAZT NEM ITT SZURJUK: hogy a cimzett a lap partnerenek munkatarsa-e,
 * azt a szolgaltatas nezi meg, mert ahhoz a LAP is kell. Egy dekorator itt
 * csak az alakot tudna ellenorizni, es az alak onmagaban semmit nem mond.
 */
export class SendWorksheetForSignatureDto {
  @IsString({ message: "Válassz aláírót a listáról." })
  @MinLength(1, { message: "Válassz aláírót a listáról." })
  signerUserId!: string;
}
