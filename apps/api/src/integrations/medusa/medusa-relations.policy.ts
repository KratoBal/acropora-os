/**
 * MI KERUL A TERMEK "HASONLO" KAPCSOLATAIBOL A MEDUSA METAADATABA, ES MILYEN
 * SORRENDBEN.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO -- ugyanabbol az okbol, amiert a
 * kategoria- es a marka-szabaly is kulon all: egy tiszta fuggveny allitasa NEV
 * SZERINT tud pirosodni, a torzs-teszte viszont a teljes lancot futtatja.
 *
 * === MIERT A METAADAT, ES MIERT AZONOSITOK ===
 *
 * A Medusa Store termekenek NINCS termek-termek kapcsolat fogalma: a
 * `StoreProduct` harminchat mezoje kozott egy sincs (merve 2026-09-08 a
 * tipuscsomagon). A dontes (acrobot, msg_id 14892) az "A" ut lett: a
 * `metadata` AZONOSITOKAT hordoz, a kirakat pedig egy MASODIK
 * lista-lekerdezessel hozza el a termekeket -- a kapcsolodo termek cime, kepe
 * es ara a SAJAT rekordjan all, tehat egy lekerdezessel szerkezetileg nem megy.
 *
 * === AMIBEN EZ A SZABALY SZANDEKOSAN MAST CSINAL, MINT A KATEGORIA ===
 *
 * A kategoria-szabaly MINDEN VAGY SEMMI: ha egy kategoria nincs lekepezve,
 * EGYIKET SEM kuldjuk, mert a `categories` mezo (a szigorubb olvasat szerint)
 * csere-szemantikaju, es egy reszleges lista LETOROLNE a tobbit.
 *
 * ITT EZ NEM ALL, es a kulonbseg a HORDOZOBOL kovetkezik: ez egy `metadata`
 * kulcs, aminek MI vagyunk a gazdaja (`unas_` elotag). Egy rovidebb lista nem
 * vesz el semmit, amit valaki mas tett oda -- csak kevesebb kapcsolodo termeket
 * mutat. Es a hianyzo lekepezes itt VARHATO allapot: egy celpont, amit meg nem
 * vetitettunk, egyszeruen meg nincs a boltban.
 *
 * A DONTES EZERT (acrobot, msg_id 15026): a lekepezetlen celpont KIMARAD, es a
 * SZAMA a vetites eredmenyebe kerul. Ha a szam nem latszik, senki nem veszi
 * eszre, hogy a kapcsolatok fele hianyzik.
 *
 * === A SORREND NEM DISZ, ES ITT DOL EL, NEM A LEKERDEZESBEN ===
 *
 * A kimeno ertek egyetlen SZTRING. Ha a sorrendje futasrol futasra valtozik, a
 * vetites minden futasban valtozast lat ott, ahol nincs -- vagyis sajat magat
 * tartja vegtelen munkaban.
 *
 * Ezert a rendezes ITT all, tiszta fuggvenyben, nem az adatbazis `orderBy`
 * mezojeben: a `sortOrder` NULLAZHATO (`Int?`), es hogy a `NULL` hova kerul,
 * az adatbazis-fuggo. Amit itt kimondunk, az nev szerint merheto.
 *
 * A rend: `sortOrder` novekvoen, a `null` ERTEKUEK A VEGERE (azok nem hordoznak
 * gondozott sorrendet), azon belul a cel-azonosito szerint.
 */

/**
 * A METAADAT-KULCS -- ES EZ A SZABALY KET REPOBAN ALL, TEHAT KI KELL MONDANI.
 *
 * Az OLVASO oldal a kirakatban van, masik repoban, es ugyanezt a sztringet
 * mondja ki egy konstansban:
 *
 *   apps/storefront/src/modules/products/components/related-products/
 *     gondozott-kapcsolatok.ts  ->  HASONLO_KULCS
 *
 * Kozos csomagba emelni ma nem lehet: a ket repo kozott nincs megosztott
 * tipuscsomag. Ez pontosan az az alak, amit a jegyzeteink "egy szabaly ket
 * helyen" neven gyujtenek -- ha a ket oldal elcsuszik, SEMMI NEM HIBAZIK: a
 * doboz egyszeruen nem jelenik meg, es a hiba NEMA.
 *
 * Amit ellene tehetunk: mindket oldalon EGY helyen all, es mindketto
 * megnevezi a masikat.
 *
 * Az `unas_` elotag a vetites mai konvencioja minden UNAS-bol szarmazo mezore
 * (`unas_unit`, `unas_minimum_order_quantity`, `unas_product_url`), es a
 * kapcsolatok is onnan jonnek. Az elotagnak KOVETKEZMENYE is van: a kulcs
 * ezzel a MIENK (`OWNED_METADATA_PREFIXES`), tehat egy futas, ami nem irja ki,
 * LE IS VESZI a cel oldalrol. Ez helyes: egy megszunt kapcsolat tunjon el a
 * boltbol is.
 */
export const MEDUSA_SIMILAR_IDS_KEY = "unas_similar_ids";

/** Az elvalaszto a metaadat-sztringben. Az olvaso oldal ugyanezzel bont. */
const ELVALASZTO = ",";

/** Egy `ProductRelation` sor annyi resze, amennyi a dontesehez kell. */
export interface ProductRelationRow {
  targetProductId: string;
  sortOrder: number | null;
}

/**
 * A HAROM ESET, ES EZERT UNIO.
 *
 * A `none` es az `incomplete` KOZOTT az a kulonbseg, ami a kategorianal is: az
 * egyik RENDBEN van (a termeknek nincs kapcsolata), a masik HIANY. Itt viszont
 * az `incomplete` MEGIS KULD erteket -- azt, ami feloldodott.
 */
export type MedusaSimilarDecision =
  | { kind: "none"; medusaSimilarIds: string[]; missing: string[] }
  | { kind: "complete"; medusaSimilarIds: string[]; missing: string[] }
  | { kind: "incomplete"; medusaSimilarIds: string[]; missing: string[] };

/**
 * A DONTES. Csak allapot megy be, csak dontes jon ki: se halozat, se adatbazis.
 *
 * A `mapping` az OS-termek azonositojatol a Medusa-azonositoig visz
 * (`MedusaProductLinkRepository.findManyByProductIds`).
 */
export function decideMedusaSimilarIds(
  relations: readonly ProductRelationRow[],
  mapping: ReadonlyMap<string, string>,
): MedusaSimilarDecision {
  if (relations.length === 0)
    return { kind: "none", medusaSimilarIds: [], missing: [] };

  /**
   * A RENDEZES A BEMENET MASOLATAN FUT. A `sort` a helyen rendez, es a hivo
   * tombje nem a mienk -- egy mellekhatas itt a hivo lekerdezesenek eredmenyet
   * irna at.
   */
  const rendezett = [...relations].sort((a, b) => {
    const aVan = a.sortOrder !== null;
    const bVan = b.sortOrder !== null;
    if (aVan !== bVan) return aVan ? -1 : 1;
    if (aVan && bVan && a.sortOrder !== b.sortOrder)
      return a.sortOrder! - b.sortOrder!;
    return a.targetProductId < b.targetProductId ? -1 : 1;
  });

  const latott = new Set<string>();
  const medusaSimilarIds: string[] = [];
  const missing: string[] = [];
  for (const sor of rendezett) {
    if (latott.has(sor.targetProductId)) continue;
    latott.add(sor.targetProductId);
    const medusaId = mapping.get(sor.targetProductId);
    if (medusaId) medusaSimilarIds.push(medusaId);
    else missing.push(sor.targetProductId);
  }

  return {
    kind: missing.length > 0 ? "incomplete" : "complete",
    medusaSimilarIds,
    missing,
  };
}

/** A metaadatba kerulo ertek. Ures listara ures sztring: a hivo hagyja el. */
export function similarIdsMetadataValue(
  medusaSimilarIds: readonly string[],
): string {
  return medusaSimilarIds.join(ELVALASZTO);
}

/**
 * A HIANY SORA -- ES SZANDEKOSAN NEM SOROLJA FEL AZ AZONOSITOKAT.
 *
 * A kategoria-hiany sora felsorolja, mert ott a POTLAS azokon az azonositokon
 * mulik, es a lista teendo. Itt a teendo MAS: a celpontok akkor kepzodnek le,
 * amikor rajuk kerul a sor a vetitesben -- nincs kulon potlas. Ami szamit, az
 * a MERETE: ha egy termek tizenot kapcsolatabol tizennegy kimarad, az mas
 * allapot, mint ha egy.
 *
 * ES AMIT A SZAM MELLE KI KELL MONDANI: ez a sor az elso teljes vetites alatt
 * MINDEN terminusnal megjelenik, es ez nem hiba. Aki a kimenetet olvassa, azt
 * nezze, hogy a szam a KOVETKEZO futasra lecsokken-e.
 */
export function describeMissingSimilarMapping(
  productId: string,
  kimaradt: number,
  osszes: number,
): string {
  return (
    `${productId}: ${kimaradt}/${osszes} hasonló kapcsolat célpontja még nincs ` +
    `leképezve a Medusára, ezért kimarad. A többi kimegy. ` +
    `Ez az első teljes vetítés alatt minden terméknél megjelenhet - ` +
    `a következő futásban a számnak csökkennie kell.`
  );
}
