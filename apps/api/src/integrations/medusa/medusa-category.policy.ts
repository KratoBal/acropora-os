/**
 * Mit kuldunk ki a termek kategoriaibol a Medusara, es mit NEM.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO -- ugyanabbol az okbol, amiert a
 * publikacios es az ar-szabaly is kulon all. A dontes eddig a parancssori
 * felulet torzseben lakott, ahol a `prisma` MODUL-SZINTU import: teszt-duplat
 * nem lehet neki adni, tehat a szabalyt csak eles adatbazissal lehetett volna
 * megnezni. Egy szabaly, amit csak eles futassal lehet merni, meretlen marad.
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
 */
export function describeMissingCategoryMapping(
  productId: string,
  missing: readonly string[],
): string {
  return (
    `${productId}: ${missing.length} kategória még nincs leképezve a Medusára ` +
    `(${missing.join(", ")}), ezért EGYIKET SEM küldjük ki: ` +
    `a részleges lista letörölhetné a többit.`
  );
}
