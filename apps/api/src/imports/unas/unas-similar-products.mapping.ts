import type { UnasSimilarProduct } from "@acropora/types";

/**
 * A HASONLO TERMEKEK MEGFELELTETESE: UNAS-azonositobol a mi termek-azonositonkra.
 *
 * A lanc harom szeletbol all, es ez a masodik. Az elso (a kinyeres) a
 * `unas-api.client.ts`-ben all: onnan `UnasSimilarProduct` peldanyok jonnek,
 * mindegyik a CELPONT UNAS-azonositojaval. A harmadik (a kapcsolat letrehozasa)
 * mar adatbazist ir. Ez a modul a kettő kozott all, es SZANDEKOSAN tiszta
 * fuggveny: adatbazis nelkul is merheto, tehat minden aga kalibralhato.
 *
 * MIERT AZONOSITO ES NEM CIKKSZAM. A masik import-ut (`unas-apply.repository.ts`)
 * cikkszam-listakbol dolgozik, es a cikkszam-parositas ket ismert hibaja miatt
 * kis-nagybetu fuggetlen visszaesest meg utkozes-agat kellett kapnia. Az
 * API-uton ez a kerdes ELO SEM ALL: a hivatkozas azonositot visel, es az
 * azonosito a UNAS oldalan egyedi. Merve a 2026-09-02 22:01-es exporton:
 * 18 499 hasonlo-termek hivatkozasbol 18 499 visel `Id`-t, nulla kivetellel.
 *
 * ES AMI EBBOL NEM KOVETKEZIK: hogy a cikkszam-kerdes megszunt. A csomag-
 * osszetevoknel (`PackageComponents`) az API is csak cikkszamot ad, ott tehat
 * a regi ut es a regi kockazat all -- ez a modul arra NEM vonatkozik.
 */

/** Egy feloldott celpont, a forras sorrendjeben. */
export interface ResolvedSimilarProduct {
  /** A mi termek-azonositonk. */
  productId: string;
  /** A celpont UNAS-azonositoja, hogy a jelentes visszakeresheto legyen. */
  externalId: string;
}

/**
 * EGY KIHAGYOTT HIVATKOZAS, A NEVEVEL EGYUTT.
 *
 * A nev nem dekoracio: egy gazdatlan hivatkozasnal az azonosito onmagaban nem
 * mond semmit annak, aki utolag nezi meg, MI veszett el. A `sku` ugyanezert all
 * itt -- azon a ket adaton keresztul lehet a UNAS feluleten megtalalni.
 */
export interface UnresolvedSimilarProduct {
  externalId: string;
  sku: string;
  name: string | null;
}

export interface SimilarProductMapping {
  /** A feloldott celpontok, a forras sorrendjeben, duplikatum nelkul. */
  targets: ResolvedSimilarProduct[];
  /**
   * A CELPONT NINCS A KATALOGUSUNKBAN. Ez az egyetlen ok a harom kozul, ami
   * ADATVESZTES -- a masik ketto szandekos kihagyas.
   */
  unresolved: UnresolvedSimilarProduct[];
  /** A termek onmagara hivatkozik. Nem hiba, de nem is kapcsolat. */
  selfReferences: number;
  /** Ugyanaz a celpont tobbszor. Nem hiba: a masodik nem visz uj informaciot. */
  duplicates: number;
}

export interface SimilarProductMappingInput {
  /** A FORRAS termek UNAS-azonositoja. */
  sourceExternalId: string;
  /**
   * A FORRAS termek sajat azonositoja nalunk, ha mar ismert.
   *
   * KULON KELL A `sourceExternalId` MELLE, ES NEM ELOVIGYAZATOSSAG. Ket
   * kulonbozo UNAS-azonosito mutathat UGYANARRA a mi termekunkre (a
   * `ExternalReference` az azonositot kotí a termekhez, es a katalogus
   * osszevonasai utan tobb sor is allhat egy termekre). Ilyenkor a hivatkozas
   * azonosito szerint MAS termek, termek szerint viszont ONMAGA -- es egy
   * onmagara mutato kapcsolat a felületen zavaró, nem hasznos.
   */
  sourceProductId?: string;
  similarProducts: readonly UnasSimilarProduct[];
  /** UNAS-azonosito -> a mi termek-azonositonk. */
  productIdsByExternalId: ReadonlyMap<string, string>;
}

/**
 * A HAROM KIHAGYASI OK KULON SZAMLALON ALL, MERT A TEENDOJUK MAS.
 *
 *   feloldatlan   -> a celpont nincs a katalogusban: ADATVESZTES, es a
 *                    jelentesben nevvel egyutt kell megjelennie
 *   onhivatkozas  -> a forras adata, nem a mienk: nincs teendo
 *   duplikatum    -> a forras ketszer sorolja fel: nincs teendo
 *
 * Egyetlen "kihagyva" szam mindharmat osszemosna, es a jelentesben ugy nezne ki,
 * mintha minden kihagyas vesztes lenne. Ugyanaz a hiba, amit a cikkszam-alapu
 * uton mar egyszer kijavitottunk.
 */
export function resolveSimilarProducts(
  input: SimilarProductMappingInput,
): SimilarProductMapping {
  const targets: ResolvedSimilarProduct[] = [];
  const unresolved: UnresolvedSimilarProduct[] = [];
  const seen = new Set<string>();
  let selfReferences = 0;
  let duplicates = 0;

  for (const reference of input.similarProducts) {
    if (reference.externalId === input.sourceExternalId) {
      selfReferences += 1;
      continue;
    }
    const productId = input.productIdsByExternalId.get(reference.externalId);
    if (!productId) {
      unresolved.push({
        externalId: reference.externalId,
        sku: reference.sku,
        name: reference.name,
      });
      continue;
    }
    if (input.sourceProductId && productId === input.sourceProductId) {
      selfReferences += 1;
      continue;
    }
    if (seen.has(productId)) {
      duplicates += 1;
      continue;
    }
    seen.add(productId);
    targets.push({ productId, externalId: reference.externalId });
  }

  return { targets, unresolved, selfReferences, duplicates };
}

/**
 * A TELJES VESZTES EGYETLEN SZAMA -- ES AZERT FUGGVENY, NEM MEZO.
 *
 * A negy szamlalo ereje az, hogy szetvalaszt. De akkor valakinek ki kell
 * mondania, hogyan kell OSSZERAKNI oket, kulonben a jelentes olvasoja a
 * legnagyobb szamot fogja vesztesnek nezni. A vesztes CSAK a feloldatlanok
 * szama: az onhivatkozas es a duplikatum szandekos kihagyas.
 */
export function similarProductDataLoss(mapping: SimilarProductMapping): number {
  return mapping.unresolved.length;
}
