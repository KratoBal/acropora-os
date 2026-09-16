import {
  ASSET_LABEL_BATCH_MAX,
  ASSET_LABEL_BATCH_MIN,
  ASSET_LABEL_CODE_SHAPE_MESSAGE,
  ASSET_LABEL_CODE_STORED_PATTERN,
  normalizeAssetLabelCode,
} from "@acropora/types";

import {
  ASSET_LIST_STATUS_FILTERS,
  type AssetListStatusFilter,
} from "../asset-status-filter.js";
import {
  ASSET_LIST_DIRECTIONS,
  ASSET_LIST_SORTS,
  type AssetListDirection,
  type AssetListSort,
} from "../asset-list-order.js";
import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
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
  "WARM_STANDBY",
  "COLD_STANDBY",
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

/**
 * A QUERY-BOL ERKEZO MATRICAKOD TAROLHATO ALAKJA.
 *
 * A BEMENET MEGENGEDOBB, MINT A TAROLT ALAK: a leolvaso es a billentyuzet
 * egyarant adhat kisbetut, es az EMBER ugyanannak a matricanak latja. A
 * felfele normalizalas ezt hozza egy alakra, ugyanazzal a fuggvennyel, amit a
 * `scan-label` vegpont hasznal -- nem egy masodik peldannyal.
 *
 * A ROSSZ ALAKOT VALTOZATLANUL ENGEDI TOVABB, ES EZ A LENYEGE. Ha `undefined`
 * lenne belole, a szuro CSENDBEN eltunne, es egy elgepelt kodra a valasz a
 * helyszin OSSZES eszkoze lenne -- egy hivo, aki az elso sort veszi, MASIK
 * eszkozt kapna, es semmi nem szolna. Igy viszont a `@Matches` utasitja el,
 * megnevezve, mi a baj.
 */
export function toStoredLabelCode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return normalizeAssetLabelCode(value) ?? value;
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
   * EGY KONKRET MATRICAKOD, PONTOS EGYEZESSEL.
   *
   * MIERT KULON A `search` MEZOTOL, HOLOTT AZ IS MEGTALALNA. A `search` EMBERI
   * mezo: reszleteket keres tobb oszlopban (`contains`), tehat egy otkarakteres
   * kodra MAS sor is illeszkedhet -- egy leltari szam, ami tartalmazza. Ez a
   * szuro viszont GEPI: a felulet azt kerdezi vele, hogy EZ A MATRICA ezen a
   * helyszinen all-e, es egy masik sor itt nem "kozeli talalat", hanem hibas
   * valasz. Ha a ketto egy mezo lenne, a `search` barmely kesobbi tagitasa
   * csendben megvaltoztatna a kod-alapu hozzaadas jelenteset.
   *
   * MIERT NEM ELEG HELYETTE A `scan-label` VEGPONT (merve 2026-09-16): az a kod
   * -> eszkoz lekepezest oldja fel, a RESZFA-TAGSAGOT nem. A valaszaban allo
   * `unit.path` NEVEKET hordoz, nem azonositokat, tehat a hivo nem tudja
   * eldonteni, hogy a talalat a valasztott helyszin ALATT all-e. A lista
   * viszont eppen azt tudja, es ugyanazt a reszfa-szabalyt hasznalja, mint a
   * mentes ellenorzese.
   */
  @Transform(({ value }) => toStoredLabelCode(value))
  @Matches(ASSET_LABEL_CODE_STORED_PATTERN, {
    message: ASSET_LABEL_CODE_SHAPE_MESSAGE,
  })
  @IsOptional()
  labelCode?: string;
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
   * A RENDEZES OSZLOPA ES IRANYA (Balazs kerese, 2026-09-16).
   *
   * A LISTA LAPOZVA JON, tehat a rendezes NEM lehet a bongeszoben: az az epp
   * latszo huszonot sort rendezne, es ugy nezne ki, mintha az egeszet tenne.
   * Ezert all a parameter itt, a lekerdezesen.
   *
   * ELHAGYVA a lista a ma is ervenyes alapertelmezest kapja (nev szerint
   * novekvo), tehat egy regi hivas beture ugyanazt adja.
   */
  @IsIn(ASSET_LIST_SORTS) @IsOptional() sort?: AssetListSort;
  @IsIn(ASSET_LIST_DIRECTIONS) @IsOptional() direction?: AssetListDirection;
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
  /**
   * AZ ALLAPOT-SZURO HAROM FAJTA ERTEKET VESZ FEL: egy konkret allapotot, az
   * `ALL` erteket, vagy az `IN_PLACE` erteket (minden, KIVEVE a kivezetettet --
   * a feluleten "Beepitett", Balazs kerese 2026-09-16). A jelentesuk az
   * `asset-status-filter.ts` fajlban all, egy helyen.
   */
  @IsIn([...ASSET_STATUSES, ...ASSET_LIST_STATUS_FILTERS])
  @IsOptional()
  status: (typeof ASSET_STATUSES)[number] | AssetListStatusFilter = "ACTIVE";
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
  /**
   * A KLIENS ALTAL ADOTT MUVELET-AZONOSITO, A HELYSZINI ROGZITES
   * IDEMPOTENCIA-KULCSA.
   *
   * ELHAGYHATO, ES EZ KIKOTES: a webes felvitel nem kuld kulcsot, es MA
   * MUKODIK. Kotelezove teve az urlapot is at kellene irni.
   *
   * AZ ALAK MEGENGEDOBB, MINT A MUNKALAP-SORE (`^[A-Za-z0-9_-]{8,64}$`), es ez
   * merve van: a telefon mai kulcsa `asset-create:<matricakod>:<ISO idopont>`
   * alaku, tehat KETTOSPONTOT es PONTOT is tartalmaz. Egy szukebb minta a
   * meglevo kliens-kulcsot utasitana el -- vagyis nem vedene, hanem elvagna.
   */
  @Matches(/^[A-Za-z0-9_.:-]{8,128}$/, {
    message:
      "A művelet-azonosító 8-128 karakter lehet: betű, szám, kötőjel, aláhúzás, pont és kettőspont.",
  })
  @IsOptional()
  clientOperationId?: string;
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
  /**
   * Előre nyomtatott matrica kódja (egy betű és négy szám, pl. V2196). Az
   * ALAKOT a szolgáltatás ellenőrzi a közös `normalizeAssetLabelCode`
   * függvénnyel, nem itt egy második mintával: két minta két helyen pontosan
   * ott csúszna el, ahol senki nem nézi.
   *
   * A SZŰRŐ `@ValidateIf`, NEM `@IsOptional()` -- UGYANAZ A RÉS, AMIT acrobot
   * A MÓDOSÍTÓ OSZTÁLYON MEGTALÁLT (2026-09-16), CSAK A FELVITELI ÁGON.
   *
   * Az `@IsOptional()` a `null`-t ugyanúgy kihagyja, mint az `undefined`-ot.
   * A `null` így eljutott a tárolóig, ahol `input.labelCode === undefined`
   * HAMIS rá, a `normalizeAssetLabelCode` pedig `raw.trim()`-et hív rajta.
   * Mérve ezen az osztályon, 2026-09-16: nulla validációs hiba, majd
   * `TypeError: Cannot read properties of null (reading 'trim')` -- amit a
   * szolgáltatás `map` függvénye a végén továbbdob, tehát **500 lett volna,
   * nem 400**.
   *
   * ÉLES TÖRÉS NEM VOLT: a webes és a mobil kliens is `?? undefined` alakban
   * küldi. A határ viszont nyitva állt, és a módosító osztály megjegyzése azt
   * sugallta, hogy a csapda kezelve van -- egy zárnak látszó nyitott ajtó
   * rosszabb a nyilván nyitottnál.
   *
   * ÉS A TESTVÉREI (`model`, `serialNumber`) MARADNAK `@IsOptional()`-ön:
   * azokat az `optionalText` nyeli el, ami a `null`-t kezeli. A matrica azért
   * más, mert a normalizálója nem.
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  labelCode?: string;
  /**
   * A BERENDEZES TELJESITMENYE, ES A MERTEKEGYSEGE.
   *
   * A KETTO EGYUTT MOZOG, es ezt a TABLA is orzi
   * (`Asset_performance_pairing_check`): egy "500" onmagaban nem informacio,
   * hanem talalgatasra hivas -- watt? liter per ora? A felallapotot a
   * szolgaltatas utasitja el, sajat mondattal, MIELOTT a CHECK uzenete
   * eljutna a felhasznalohoz.
   *
   * A szam SZOVEGKENT erkezik, es ez szandekos: a `number` a JSON-ban
   * lebegopontos, tehat egy `0.1`-es lepteku ertek mar az uton elcsuszhatna.
   * A `Decimal` oszlop pontosan azt tarolja, amit a kezelo beirt.
   */
  @IsString() @IsOptional() performance?: string;
  /**
   * A mezo neve NEM `unitId`: az MAR FOGLALT ezen a modellen, es a HELYSZINT
   * jelenti. Lasd a `UnitOfMeasure` sema-fejlecet.
   */
  @IsString() @IsOptional() performanceUnitId?: string;
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
  /**
   * Előre nyomtatott matrica kódja, UTÓLAG is. Az ALAKOT a szolgáltatás
   * ellenőrzi a közös `normalizeAssetLabelCode` függvénnyel, nem itt egy
   * második mintával -- ugyanaz az indok, mint a `CreateAssetDto`-nál.
   *
   * A MEZŐ ELHAGYÁSA ÉRINTETLENÜL HAGYJA a meglévő matricát. Egy ÜRES SZÖVEG
   * viszont NEM azt jelenti, hogy "nincs matrica", hanem hogy érvénytelen kód:
   * a felvitelnél ugyanez a szabály áll a webes űrlapon.
   *
   * ÉS ITT SZÁNDÉKOSAN NINCS `| null`, holott a többi mezőn ott van. A `null`
   * ezen az osztályon azt jelenti, hogy "töröld a kötést" -- a matrica
   * LESZEDÉSE viszont ebben a körben nem készült el, és az ok nem a mechanika:
   * az esemény-naplónak NINCS NEVE rá. Az egyetlen létező típus a
   * `LABEL_ASSIGNED`, ami épp az ellenkezőjét mondja, egy `LABEL_RELEASED`
   * felvétele pedig séma-migráció.
   *
   * === A `@ValidateIf` NEM DÍSZ, ÉS AZ `@IsOptional()` NEM HELYETTESÍTI ===
   *
   * Itt korábban `@IsString() @IsOptional()` állt, a megjegyzés pedig azt
   * ígérte, hogy egy `null` "hangosan elbukik a validáción". NEM BUKOTT EL: az
   * `@IsOptional()` dokumentált viselkedése, hogy a `null` értéket UGYANÚGY
   * kihagyja, mint az `undefined`-ot.
   *
   * MÉRVE ezen az osztályon (class-validator 0.15.1): a hiányzó mező, az
   * `undefined`, a `null`, az üres szöveg és a `V2196` MIND átment; egyedül
   * egy szám bukott el ("labelCode must be a string").
   *
   * A következménye nem elméleti volt. A `null` így eljutott a tárolóig, ahol
   * `input.labelCode !== undefined` IGAZ rá, és a `normalizeAssetLabelCode`
   * `raw.trim()` hívása `TypeError`-t dobott -- amit a szolgáltatás `map`
   * függvénye a végén továbbdob, tehát **500 lett belőle, nem 400**. És a
   * `null` nem kitalált eset: ezen az osztályon MINDEN testvér `string | null`,
   * és a webes szerkesztő minden szöveges mezőre ezt az alakot küldi.
   *
   * A `@ValidateIf` az `undefined`-ra kapcsolja KI az ellenőrzést, a `null`-ra
   * nem -- így a mező azt csinálja, amit a fenti bekezdés ígér. Aki ezt valaha
   * "egyszerűsítené" vissza `@IsOptional()`-ra, csendben újranyitja a rést;
   * ezért áll mellette állítás is (`asset-update-dto.spec.ts`).
   *
   * (acrobot mérése, 2026-09-16, a #715 átvételekor. Visszamértem ezen az
   * osztályon: a táblázata betűre kijött.)
   */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  labelCode?: string;
  /**
   * A BERENDEZES TELJESITMENYE, ES A MERTEKEGYSEGE.
   *
   * A KETTO EGYUTT MOZOG, es ezt a TABLA is orzi
   * (`Asset_performance_pairing_check`): egy "500" onmagaban nem informacio,
   * hanem talalgatasra hivas -- watt? liter per ora? A felallapotot a
   * szolgaltatas utasitja el, sajat mondattal, MIELOTT a CHECK uzenete
   * eljutna a felhasznalohoz.
   *
   * A `null` MIND A KET mezon a TORLEST jelenti, a tobbi mezovel egyezoen --
   * es a ketto CSAK EGYUTT torolheto, ugyanabbol az okbol.
   *
   * A szam SZOVEGKENT erkezik, es ez szandekos: a `number` a JSON-ban
   * lebegopontos, tehat egy `0.1`-es lepteku ertek mar az uton elcsuszhatna.
   * A `Decimal` oszlop pontosan azt tarolja, amit a kezelo beirt.
   */
  /**
   * A SZURO A `null`-T ATENGEDI, A `labelCode`-dal ELLENTETBEN -- es a ket
   * ellentetes alak ugyanabbol a szabalybol jon: a `null` ezen az osztalyon
   * TORLEST jelent, es itt a torles LETEZIK (a matricanal nem). Ezert a
   * feltetel `undefined` ES `null` eseten hagyja ki az ellenorzest, nem csak
   * `undefined`-nal.
   */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  performance?: string | null;
  /**
   * A mezo neve NEM `unitId`: az MAR FOGLALT ezen a modellen, es a HELYSZINT
   * jelenti. Lasd a `UnitOfMeasure` sema-fejlecet.
   */
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsString()
  performanceUnitId?: string | null;
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

/**
 * UJ MATRICA-TETEL GENERALASA.
 *
 * A felso hatar a kozos csomagbol jon, nem itt beirt szam: a felulet ES a
 * szerver ugyanazt a korlatot kell mondja, kulonben a felhasznalo azt latja,
 * hogy az urlap atengedi, a mentes meg elutasitja.
 */
export class IssueAssetLabelBatchDto {
  @Type(() => Number)
  @IsInt()
  @Min(ASSET_LABEL_BATCH_MIN)
  @Max(ASSET_LABEL_BATCH_MAX)
  count!: number;
}

/** A korabbi generalasok listaja. */
export class AssetLabelBatchQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;
}
