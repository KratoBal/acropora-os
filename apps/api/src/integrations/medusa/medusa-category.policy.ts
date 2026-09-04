/**
 * Mit kuldunk ki a termek kategoriaibol a Medusara, es mit NEM.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO -- ugyanabbol az okbol, amiert a
 * publikacios es az ar-szabaly is kulon all. Egy szabaly, amit csak eles
 * futassal lehet merni, meretlen marad. *
 * AZ EREDETI INDOK AZOTA ELAVULT, ES A KOVETKEZTETESE MA MAR HAMIS. Ez a
 * bekezdes ugy szolt, hogy a torzs a `prisma`-t MODUL-SZINTU importbol veszi,
 * TEHAT teszt-duplat nem lehet neki adni. Az elso fele ma is igaz (az
 * alapertelmezeshez), a masodik nem: a `db` parameter (2026-09-04, #515) ota a
 * torzs MERHETO, es harom allitas fut rajta.
 *
 * A KOVETKEZTETES VALTOZATLAN, AZ OKA MAS: egy tiszta fuggveny allitasa NEV
 * SZERINT tud pirosodni, a torzs-teszte viszont a TELJES lancot futtatja. Ha
 * ez a szabaly a torzsben allna, egy rontasa utan nem lehetne megmondani,
 * MELYIK resz romlott el.
 *
 * ES A "PARANCS TORZSE" KIFEJEZES IS ELAVULT: a torzs 2026-09-04 ota a
 * `medusa-projection.runner.ts` modulban all (#518), a parancs maga kilenc sor.
 *
 * A SZABALY MINDEN VAGY SEMMI, ES EZ SZANDEKOS. Ha akar EGY kategoria hianyzik
 * a lekepezesbol, EGYIKET SEM kuldjuk. Egy reszleges lista ugyanis -- HA a
 * `categories` mezo csere-szemantikaju -- CSENDBEN levenne a termekrol azokat
 * a kategoriakat, amiket nem tudtunk megnevezni.
 *
 * AMI EBBOL MERT, ES AMI NEM: a `sales_channels` csere-szemantikajat a
 * telepitett Medusa 2.19.0 forrasabol MERTUK (ott az ures lista a lekotes). A
 * `categories`-ra ugyanez NINCS megmerve: a termek-frissites csere-listaja
 * (`relations: ["options", "options.values", "tags"]`) nem tartalmazza, tehat
 * mas uton kezelodik, es hogy melyiken, azt ez a listahiany nem mondja meg.
 * Amig nincs megmerve, a szigorubb olvasat szerint jarunk el -- es a teendo
 * mindket olvasat mellett ugyanaz: ha nincs mit kuldeni, a mezo ELMARAD.
 */

/**
 * A LEKEPEZES-SOR KERESESI KULCSA, EGY HELYEN.
 *
 * Ket mezobol all, es a KETTO NEM EGYFORMAN VEDETT. A `system` a sema
 * `ExternalSystem` ENUMJA: aki mellenyul, forditasi hibat kap. Az `entityType`
 * viszont szabad `String` -- ott semmi nem szol, ha ket iró ket irasmodot
 * hasznal.
 *
 * ES A KEVEREDES NEM ELMELETI: a repoban MINDKET alak el. Merve a `f40a442`
 * bazison: `entityType: "Category"` TIZENEGYSZER, `entityType: "CATEGORY"`
 * NEGYSZER -- es a ket alak KET KULONBOZO tablahoz tartozik. A nagybetus mind a
 * negy a behozatali sorok `CatalogImportEntityType` ENUMJA (ott a fordito szol),
 * az `ExternalReference` minden elofordulasa `"Category"`. Vagyis ma nincs
 * keveredes -- de a ket irasmod ugyanabban a modulban all egymas mellett
 * (`unas-import.service.ts` kontra `unas-apply.repository.ts`), tehat a
 * masolashoz nem kell tevedni, csak a szomszed sorra nezni.
 *
 * A BAZIST AZERT KELL ODAIRNI, mert a szam MOZOG: a tizenegyedik elofordulas
 * epp a vetites parancsanak sajat literalja, amit ez a modul szuntet meg. Egy
 * darabszam a bazisa nelkul nem allitas, hanem hivatkozas.
 *
 * A BETOLTES ES A VETITES A TABLA KET VEGE: az egyik ide IR, a masik innen
 * OLVAS. Amig a kulcs egy helyen all, nem tudnak elcsuszni egymastol.
 */
export const MEDUSA_CATEGORY_REFERENCE = {
  system: "MEDUSA",
  entityType: "Category",
} as const;

/** Egy lekepezes-sor: a mi kategoriank, es a Medusa-oldali azonositoja. */
export interface MedusaCategoryMapping {
  entityId: string;
  externalId: string;
}

/**
 * A HAROM ESET, ES EZERT UNIO ES NEM KET MEZO.
 *
 * A `none` es az `incomplete` a KERES TORZSERE nezve ugyanaz: egyik sem kuld
 * `categories` kulcsot. A KOVETKEZMENYUK viszont ellentetes:
 *
 *   `none`       -- a termeknek nincs kategoriaja. Ez RENDBEN van, nincs teendo.
 *   `incomplete` -- van, de valamelyik meg nincs lekepezve. Ez HIANY: ha nem
 *                   mondjuk ki, a besorolas csendben elmarad, es senki nem
 *                   fogja tudni, melyik eset allt fenn.
 *
 * Ha a ket allapotot egyetlen `string[] | null` hordozna, a kulonbseg a hivo
 * oldalan visszafejthetetlen lenne -- ott mar csak a `null` erkezik meg.
 */
export type MedusaCategoryDecision =
  | { kind: "none"; medusaCategoryIds: null; missing: string[] }
  | { kind: "complete"; medusaCategoryIds: string[]; missing: string[] }
  | { kind: "incomplete"; medusaCategoryIds: null; missing: string[] };

/**
 * A DONTES. Csak allapot megy be, csak dontes jon ki: se halozat, se adatbazis.
 *
 * KET RESZLET, AMI NEM STILUS:
 *
 * 1. A HIANYT HALMAZ-LEFEDESSEL szamoljuk, nem a ket lista HOSSZANAK
 *    osszevetesevel. Ma a ket alak egyenerteku, mert a sema mindket oldalon
 *    kizarja a duplikaciot (`ProductCategory @@unique([productId, categoryId])`
 *    es `ExternalReference @@unique([system, entityType, entityId])`). De a
 *    hossz-alak EGY hianyzo megszorítastol NEMA hibava valna: egy duplikalt
 *    lekepezes-sor plusz egy hianyzo kategoria ugyanazt a hosszt adja, mint a
 *    teljes lefedes -- es akkor reszleges listat kuldenenk ki, pontosan azt,
 *    amit ez a modul meg akar elozni. A halmaz-alak akkor is helyes marad.
 *
 * 2. A KIMENO SORREND a BEMENET sorrendjet koveti, nem a lekepezes-sorokét. A
 *    lekerdezes visszateresi sorrendje nem garantalt; egy nem determinisztikus
 *    keres-torzset pedig nem lehet ket futas kozott osszevetni.
 */
export function decideMedusaCategories(
  osCategoryIds: readonly string[],
  mappings: readonly MedusaCategoryMapping[],
): MedusaCategoryDecision {
  /** A bemenet sorrendjet megtartva, ismetlodes nelkul. */
  const wanted = [...new Set(osCategoryIds)];
  if (wanted.length === 0)
    return { kind: "none", medusaCategoryIds: null, missing: [] };

  const byEntityId = new Map(
    mappings.map((row) => [row.entityId, row.externalId] as const),
  );
  const missing = wanted.filter((id) => !byEntityId.has(id));
  if (missing.length > 0)
    return { kind: "incomplete", medusaCategoryIds: null, missing };

  return {
    kind: "complete",
    medusaCategoryIds: wanted.map((id) => byEntityId.get(id)!),
    missing: [],
  };
}

/**
 * A HIANY SORA. Megnevezi, HANY kategoria hianyzik es MELYIKEK, mert a
 * lekepezes potlasa pontosan azokon az azonositokon mulik -- egy darabszammal
 * senki nem tud mit kezdeni.
 *
 * ES A ZARO MONDAT KET KULONBOZO OKOT VALASZT SZET, AMIK UGYANEZT A KIMENETET
 * ADJAK (murena merese, 2026-09-02):
 *
 *   a betoltes MEG NEM FUTOTT LE             -> minden kategoria "nincs lekepezve"
 *   a betoltes lefutott, ROSSZ azonositoval  -> minden kategoria "nincs lekepezve"
 *
 * A masodik nem elmeleti: a kategoriafa forras-fajlja az UNAS azonositoit
 * hordozza, nem a mieinket, es ha azok kerulnenek a lekepezes-sor `entityId`
 * mezojebe, MINDEN keresesunk uresen ternee vissza. Aki a kimenetet a futas
 * UTAN olvassa, ugyanazt a mondatot latja, mint aki elotte -- es a kezenfekvo
 * olvasat az lesz, hogy "meg nem futott".
 *
 * AMI SZETVALASZTJA, EGY LEKERDEZES: hany MEDUSA/Category sor all a tablaban.
 * Ezt a fuggveny NEM kerdezi le, es szandekosan nem: attol adatbazis-fuggo
 * lenne, es epp azert kerult ide, hogy ne legyen az. Csak MEGMONDJA, mit kell
 * megnezni -- ugyanaz a minta, mint a keszlet-parancs hiany-soranal, ami a
 * sajat hatokoret irja oda.
 */
export function describeMissingCategoryMapping(
  productId: string,
  missing: readonly string[],
): string {
  return (
    `${productId}: ${missing.length} kategória még nincs leképezve a Medusára ` +
    `(${missing.join(", ")}), ezért EGYIKET SEM küldjük ki: ` +
    `a részleges lista letörölhetné a többit. Ha MINDEN terméknél ezt látod, ` +
    `a leképezés-tábla vagy üres (a betöltés nem futott), vagy rossz ` +
    `azonosítókkal telt meg - a kettőt a MEDUSA/Category sorok száma dönti el.`
  );
}
