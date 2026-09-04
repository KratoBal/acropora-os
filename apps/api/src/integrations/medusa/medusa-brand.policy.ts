/**
 * Mit kuldunk ki a termek MARKAJABOL a Medusara, es mit NEM.
 *
 * KULON MODUL, ADATBAZIS NELKUL MERHETO, ugyanabbol az okbol, amiert a
 * kategoria-, a publikacios es az ar-szabaly is kulon all. *
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
 * MIERT COLLECTION, ES NEM MAS. A telepitett Medusa 2.19.0 Product modelljenek
 * NINCS marka mezoje. Negy hely johetne szoba, es a bolti API mind a negyre tud
 * szurni (`category_id`, `collection_id`, `tag_id`, `type_id`):
 *
 *   categories  MAR FOGLALT: oda a UNAS kategoriafaja megy
 *   tags        manyToMany, tehat egy termek TOBB markat is kaphatna. A hiba
 *               ott NEMA lenne: senki nem venne eszre a masodik markat
 *   type        mukodne (egy-egy kapcsolat, szurheto), de NINCS `handle` mezoje
 *   collection  egy-egy kapcsolat, szurheto, ES van `handle`-je
 *
 * A `handle` dontott: egyedul a collection ad natv marka-oldalt sajat cimmel.
 *
 * AMIT EZ MEGKOT, ES AMI HANGOS: egy termek EGY collectionhoz tartozhat. Ha a
 * kirakat kesobb kampany-gyujtemenyt akar, az UTKOZIK a markaval -- de azonnal
 * kiderul, es akkor a kampany megy `tags`-be. Ezert valasztottuk igy: a masik ket
 * tevedes (tag: tobb marka; type: nincs cim) csendben romlana el.
 *
 * A MEZO ELHAGYASA ES A `null` NEM UGYANAZ, ugyanugy, mint a kategoriaknal es a
 * metaadatnal. Ha nincs mit kuldeni, a mezo ELMARAD: a vetites nem a marka
 * gazdaja, es egy kikuldott `null` levenne azt, amit a bolt oldalan barki mas oda
 * tett.
 */

/**
 * A LEKEPEZES-SOR KERESESI KULCSA, EGY HELYEN.
 *
 * Ugyanaz a szerkezet, mint a kategorianal: az `ExternalReference` tablaban all,
 * `system` plusz `entityType` kulccsal. A `system` a sema `ExternalSystem`
 * ENUMJA (aki mellenyul, forditasi hibat kap), az `entityType` viszont szabad
 * `String` -- ott semmi nem szol, ha ket iro ket irasmodot hasznal. Ezert all itt
 * egy helyen, es ezert nem literalkent a hivoban.
 *
 * ES EZERT NEM KELL UJ TABLA: az `entityType` uj erteke NEM sema-valtozas. A
 * marka-lekepezes ugyanabban a tablaban el, mint a termeke es a kategoriae.
 *
 * AZ ERTEK A CEL OLDALI ENTITAST NEVEZI MEG (`ProductCollection`), nem a
 * mienket (`Brand`). Ez szandekos: a tabla masik ket MEDUSA-kulcsa
 * (`Product`, `Category`) is azt mondja meg, MI all a Medusa oldalan. Ha a
 * markat egyszer maskent abrazolnank ott, a kulcs is valtozna, es a regi sorok
 * nem keverednenek az ujakkal.
 */
export const MEDUSA_BRAND_REFERENCE = {
  system: "MEDUSA",
  entityType: "ProductCollection",
} as const;

/** Egy lekepezes-sor: a mi markank, es a Medusa-oldali gyujtemeny azonositoja. */
export interface MedusaBrandMapping {
  entityId: string;
  externalId: string;
}

/**
 * A HAROM ESET, ES EZERT UNIO ES NEM EGY `string | null`.
 *
 * A `none` es az `unmapped` a keres TORZSERE nezve ugyanaz: egyik sem kuld
 * `collection_id` kulcsot. A KOVETKEZMENYUK viszont ellentetes:
 *
 *   `none`      -- a termeknek nincs feloldott markaja. Ez RENDBEN van: a marka
 *                  feloldasa emberi jovahagyashoz kotott lepes (lasd a sema
 *                  `BrandResolutionReview` tablajat), tehat a hianya nem hiba.
 *   `unmapped`  -- VAN markaja, de az meg nincs lekepezve a Medusara. Ez HIANY:
 *                  ha nem mondjuk ki, a marka csendben elmarad, es a kimenetbol
 *                  nem lehetne megmondani, melyik eset allt fenn.
 *
 * Ha a ket allapotot egyetlen `string | null` hordozna, a kulonbseg a hivo
 * oldalan visszafejthetetlen lenne: ott mar csak a `null` erkezik meg.
 */
export type MedusaBrandDecision =
  | { kind: "none"; medusaCollectionId: null; missingBrandId: null }
  | { kind: "mapped"; medusaCollectionId: string; missingBrandId: null }
  | { kind: "unmapped"; medusaCollectionId: null; missingBrandId: string };

/**
 * A DONTES. Csak allapot megy be, csak dontes jon ki: se halozat, se adatbazis.
 *
 * A `mappings` LISTA, nem egyetlen sor, mert a hivo egy lekerdezessel tobb
 * termek markajat is feloldhatja, es akkor a szures itt tortenik. Egy elemre
 * szukitett parameter arra kenyszeritene a hivot, hogy termekenkent kerdezzen.
 */
export function decideMedusaBrandCollection(
  brandId: string | null,
  mappings: readonly MedusaBrandMapping[],
): MedusaBrandDecision {
  if (!brandId)
    return { kind: "none", medusaCollectionId: null, missingBrandId: null };

  const match = mappings.find((row) => row.entityId === brandId);
  if (!match)
    return {
      kind: "unmapped",
      medusaCollectionId: null,
      missingBrandId: brandId,
    };

  return {
    kind: "mapped",
    medusaCollectionId: match.externalId,
    missingBrandId: null,
  };
}

/**
 * A HIANY SORA. Megnevezi, MELYIK marka nincs lekepezve, mert a potlas pontosan
 * azon az azonositon mulik.
 *
 * ES A ZARO MONDAT KET KULONBOZO OKOT VALASZT SZET, amik ugyanezt a kimenetet
 * adjak -- ugyanaz a minta, mint a kategoria hiany-soranal:
 *
 *   a marka-gyujtemenyek betoltese MEG NEM FUTOTT LE  -> minden marka "nincs lekepezve"
 *   lefutott, ROSSZ azonositoval                      -> minden marka "nincs lekepezve"
 *
 * AMI SZETVALASZTJA, EGY LEKERDEZES: hany MEDUSA/ProductCollection sor all a
 * tablaban. Ezt a fuggveny NEM kerdezi le, es szandekosan nem: attol
 * adatbazis-fuggo lenne, es epp azert kerult ide, hogy ne legyen az. Csak
 * MEGMONDJA, mit kell megnezni.
 */
export function describeMissingBrandMapping(
  productId: string,
  brandId: string,
): string {
  return (
    `${productId}: a termék márkája (${brandId}) még nincs leképezve a ` +
    `Medusára, ezért gyűjtemény nélkül megy ki. Ha MINDEN terméknél ezt látod, ` +
    `a leképezés-tábla vagy üres (a márka-gyűjtemények betöltése nem futott), ` +
    `vagy rossz azonosítókkal telt meg - a kettőt a MEDUSA/ProductCollection ` +
    `sorok száma dönti el.`
  );
}
