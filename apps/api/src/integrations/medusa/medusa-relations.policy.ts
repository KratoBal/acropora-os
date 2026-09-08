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
 * megnevezi a masikat. (A tuloldali megnevezes 2026-09-08 ota all a kirakat
 * fajljaban is, A SOR MELLETT -- aki atnevez, kereses-cserevel dolgozik es a
 * talalt sort latja, nem a fajl tetejet.)
 *
 * ES AMIT EZ NEM AD MEG, MERT KULONBEN TOBB VEDELMET IGERNE, MINT AMENNYI ALL
 * (nautilus merese, 2026-09-08, ket kalibracioval a kirakat oldalan):
 *
 *   ha CSAK az egyik konstans csuszik el (veletlen elirás)   ket teszt PIROS,
 *     nev szerint, a `lap-vaz/valodi-tartalom.spec.tsx`-ben -- mert annak a
 *     FIXTURE-je a literalt irja, mikozben a kod a konstanson at olvas;
 *   ha valaki KOVETKEZETESEN nevezi at az EGYIK repoban (a konstanst ES a
 *     sajat pinjet)                                          479 teszt fut le,
 *     NULLA piros, es az a repo semmit nem vesz eszre.
 *
 * A masodik a valodi kockazat, es erre ez a megjegyzes CIMZES: nem sul el
 * semmire, azt eri el, hogy aki atnevez, tudja, hol a masik fele.
 *
 * DE NEM EZ AZ EGYETLEN, AMI SZOL -- ES A KORABBI SZOVEG EZT ELHALLGATTA.
 * HELYESBITVE: MAR VAN ORZO, ES A HELYESBITES SAJAT MULASZTASBOL ERED.
 *
 * Barracuda 2026-09-08 delelott megirta, es a kozos mappaban all:
 *
 *     bash /home/marveen/marveen/scripts/hasonlo-kulcs-orzo.sh
 *
 * A GitHub API-rol olvassa MINDKET repo fo agat -- nincs klon es nincs ref,
 * tehat nincs mihez kepest elavulni --, es nem csak a KULCSOT veti ossze, hanem
 * az ELVALASZTOT is: annak az elcsuszasa meg nemabb lenne, mert a doboz
 * megjelenne, csak nulla termekkel. Harom kilepesi kod, es a harmadik a lenyeg:
 * 0 egyezik, 1 elcsusztak (nev szerint), 2 NEM MERHETO -- mert egy atnevezett
 * konstans NULLA talalatot ad, es a naiv osszevetes ilyenkor ZOLDET adna.
 * Mindket irany kulon kalibralva; napi utemezesben fut.
 *
 * AMIT AZ ORZO MA NEM FED, ismert pozitiv kontrollal merve (a hasonlo kulcsra
 * ot emlites all benne, a kiegeszitore nulla):
 *
 *   a `MEDUSA_ACCESSORY_IDS_KEY`   nincs benne
 *   hogy az adat TENYLEGESEN atmegy-e   azt csak a bolt oldalan lehet megnezni
 *
 * A masodikra szant ellenorzes (legalabb N termek visel ilyen kulcsot) ma meg
 * nem irhato meg: 2026-09-08-an a stage 1492 termekebol EGY viseli a
 * `unas_similar_ids` kulcsot, es nulla a `unas_accessory_ids`-t. Egy ilyen orzo
 * ma tobb hamis riasztast adna, mint valodit -- de ez KIEGESZITES a meglevo
 * orzohoz, nem az elso vedelem.
 *
 * Az `unas_` elotag a vetites mai konvencioja minden UNAS-bol szarmazo mezore
 * (`unas_unit`, `unas_minimum_order_quantity`, `unas_product_url`), es a
 * kapcsolatok is onnan jonnek. Az elotagnak KOVETKEZMENYE is van: a kulcs
 * ezzel a MIENK (`OWNED_METADATA_PREFIXES`), tehat egy futas, ami nem irja ki,
 * LE IS VESZI a cel oldalrol. Ez helyes: egy megszunt kapcsolat tunjon el a
 * boltbol is.
 */
export const MEDUSA_SIMILAR_IDS_KEY = "unas_similar_ids";

/**
 * A KIEGESZITOK KULCSA. UGYANAZ A SZABALY, MASIK LISTA -- es a `-sotet` vegu
 * token-nevsema hibajat itt NEM ismeteljuk meg: a ket kulcs ket KULONBOZO
 * dolgot nevez meg, nem ugyanannak a ket valtozatat.
 *
 * MIERT KET KULON LISTA, ES NEM EGY: a TERV mondja meg. A lampa lapjanak bal
 * oszlopaban a vegen KET lista all -- "Ami meg kellhet hozza" (kiegeszito) es
 * "Hasonlo lampak" (alternativa) --, a korall lapon csak egy. Vagyis a ket
 * doboz nem a mi tagolasunk, hanem a tervbol jon.
 *
 * AZ OLVASO OLDAL A MASIK REPOBAN VAN. Amikor ez a megjegyzes keszult, MEG NEM
 * LETEZETT, es a szoveg ezt mondta ki: a kulcs kimegy, es senki nem olvassa.
 * A szandekos sorrend helyes volt -- de a mondat 2026-09-08 19:44:09 ota HAMIS,
 * es NEM elavulas tette azza, hanem ugyanannak a kéznek a kesobbi lepese
 * (acropora-commerce #239).
 *
 * PAR: acropora-commerce
 *      apps/storefront/src/modules/products/components/related-products/
 *        gondozott-kapcsolatok.ts:101   export const KIEGESZITO_KULCS
 *      ugyanott :176                    kiegeszitoAzonositok()
 *      lap-vaz/valodi-tartalom.tsx:492  a vaz `kiegeszitok` doboza ezen all
 *
 * Ugyanaz a helyzet, mint a hasonlo kulcsnal egy bekezdessel feljebb: ket repo,
 * kozos csomag nelkul, es ha a ket sztring elter, a doboz CSENDBEN ures marad.
 * Ez tehat nem orzo, hanem CIMZES -- nem sul el semmire; azt eri el, hogy aki
 * atnevez, tudja, hol a masik fele.
 *
 * AMI A KET KULCS KOZOTT MEGIS KULONBSEG, ES ERDEMES TUDNI: a hasonlo kulcs mar
 * kimegy a boltba, ez meg nem. Merve 2026-09-08 19:23:05-kor a teszt bolton, a
 * teljes katalogust vegiglapozva: 1492 termek, `unas_similar_ids` EGYEN,
 * `unas_accessory_ids` NULLAN. Es ez NEM idozites, hanem ADAT: a vetites a
 * kulcsot csak nem ures listara irja ki (lasd a `length > 0` feltetelt a
 * `medusa-product-projection.service.ts`-ben), tehat ugyanaz a termek, amelyik
 * megkapta a hasonlo kulcsot, kiegeszito kapcsolat nelkul all.
 */
export const MEDUSA_ACCESSORY_IDS_KEY = "unas_accessory_ids";

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
  return decideRelationIds(relations, mapping);
}

/**
 * A KIEGESZITOK DONTESE -- SZO SZERINT UGYANAZ A SZABALY.
 *
 * ES EZ NEM VELETLEN EGYBEESES, HANEM DONTES, ezert all itt kimondva:
 *
 *   sorrend      a `sortOrder` szerint, a null ertekuek a vegen, azonossag
 *                eseten az azonosito szerint -- hogy ket futas UGYANAZT adja
 *   ismetlodes   az elso elofordulas szamit, a tobbi kiesik
 *   lekepezetlen NEM esik ki csendben: a `missing` listaba kerul, es a hivo
 *                kiirja a szamat
 *
 * HA A KET SZABALY VALAHA ELTER, AZ KULON DONTES LESZ, es akkor a kozos torzs
 * ketté valik. Amig egy fuggveny szolgalja ki mind a kettot, addig nem tudnak
 * eszrevetlenul elcsuszni egymastol.
 */
export function decideMedusaAccessoryIds(
  relations: readonly ProductRelationRow[],
  mapping: ReadonlyMap<string, string>,
): MedusaSimilarDecision {
  return decideRelationIds(relations, mapping);
}

/** A kozos torzs. Csak allapot megy be, csak dontes jon ki. */
function decideRelationIds(
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

/**
 * A KET DONTES OSSZERAKASA A VETITENDO TERMEKRE.
 *
 * MIERT KULON FUGGVENY, HOLOTT KET SOR: mert a runner torzse NEM MERHETO. A
 * modul-szintu `prisma` import miatt adatbazis nelkul nem fut le, tehat egy
 * rontas ott NULLA pirosat ad -- lemertem: a kiegeszitok atadasanak elhagyasa
 * a teljes keszletbol egyetlen allitast sem dontott el.
 *
 * ES AMIT EZ VALOJABAN VED, AZ NEM AZ ELHAGYAS, HANEM A FELCSERELES. A ket
 * dontes tipusa AZONOS (`MedusaSimilarDecision`), tehat a fordito NEM szol, ha
 * valaki a hasonlokat teszi a kiegeszito mezobe. Ez a fuggveny az egyetlen
 * hely, ahol ez a hozzarendeles KIMONDVA all, es allitassal orizheto.
 */
export function relationFieldsForProjection(
  similar: MedusaSimilarDecision,
  accessory: MedusaSimilarDecision,
): { medusaSimilarIds: string[]; medusaAccessoryIds: string[] } {
  return {
    medusaSimilarIds: similar.medusaSimilarIds,
    medusaAccessoryIds: accessory.medusaSimilarIds,
  };
}

/**
 * A metaadatba kerulo ertek. Ures listara ures sztring: a hivo hagyja el.
 *
 * KOZOS A KET LISTARA, es ez szandekos: a ket kulcs kulonbozo, az ERTEK ALAKJA
 * nem. Ha kulon fuggveny allna mindkettore, egy elvalaszto-csere csak az egyiket
 * erintene, es az olvaso oldal NEMAN esne szet a masiknal.
 */
export function relationIdsMetadataValue(medusaIds: readonly string[]): string {
  return medusaIds.join(ELVALASZTO);
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
export function describeMissingAccessoryMapping(
  productId: string,
  kimaradt: number,
  osszes: number,
): string {
  return (
    `${productId}: ${kimaradt}/${osszes} kiegészítő kapcsolat célpontja még nincs ` +
    `leképezve a Medusára, ezért kimarad. A többi kimegy. ` +
    `Ez az első teljes vetítés alatt minden terméknél megjelenhet - ` +
    `a következő futásban a számnak csökkennie kell.`
  );
}

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
