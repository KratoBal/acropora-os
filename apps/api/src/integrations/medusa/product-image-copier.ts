import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import { storageKeyFor } from "../../service-assets/document-store/document-storage-key.js";
import { productImageDocumentId } from "./product-image-storage-key.js";

/**
 * A KEP MESTERE ATKERUL A MI OLDALUNKRA.
 *
 * MIERT KELL, ES MIERT NEM ELEG A BOLTBA FELTOLTENI: a bolt alkalmazasanak
 * NULLA allando tarhelye van (merve a Coolify felulerol), tehat egy telepites
 * elviheti a fajljait. Ha a mester nalunk all, a vetites egyszeruen ujratolt.
 * Ha nem, akkor a UNAS-rol kellene ujra lehivni -- ami MA megy, es a koltozes
 * utan nem. Ez nem "atmeneti alak", hanem egy fuggoseg, ami pont akkor szunne
 * meg mukodni, amikor a legjobban kellene.
 *
 * EZ A LEPES A LANC ELSO LABA, es a masodik (a boltba feltoltes) erre epul.
 */

/** Egy kep, amit at kell hozni. */
export interface CopyableImage {
  id: string;
  productId: string;
  url: string;
}

export interface ImageCopyOutcome {
  /** Athozva, es a `storageKey` rogzitve. */
  copied: number;
  /** Mar ott volt a taroloban -- csak a mezot irtuk vissza. */
  alreadyStored: number;
  /** Nem sikerult, es a sor VALTOZATLAN maradt. */
  failed: { imageId: string; url: string; reason: string }[];
}

export interface ImageCopyDeps {
  /** A kep bajtjainak lehivasa. A `fetch` azert parameter, hogy a keres ALAKJA merheto legyen. */
  fetchImpl: typeof fetch;
  store: DocumentStore;
  /** A `storageKey` visszairasa a sorra. */
  recordStorageKey(imageId: string, storageKey: string): Promise<void>;
}

/**
 * EGY KEP ATHOZASA, ES A LEPESEK SORRENDJE NEM CSERELHETO FEL.
 *
 * eloszor a TAROLO, aztan a MEZO. Ha forditva lenne, egy sikeres mezo-iras utan
 * elhasalo tarolas olyan sort hagyna maga utan, ami AZT ALLITJA, hogy a kep
 * nalunk van -- es a kesobbi feltoltes egy nem letezo fajlt keresne. A mai
 * sorrendben a legrosszabb eset egy ARVA FAJL a lemezen, amit az egyeztetes
 * megtalal.
 */
async function copyOne(
  image: CopyableImage,
  deps: ImageCopyDeps,
): Promise<"copied" | "already" | { reason: string }> {
  const key = {
    owner: "product" as const,
    ownerId: image.productId,
    documentId: productImageDocumentId(image.url),
  };
  const storageKey = storageKeyFor(key);

  /**
   * A TAROLO MAGA A NYILVANTARTAS, NEM A MEZO.
   *
   * A `storageKey` mezo minden UNAS-import utan NULLRA all vissza, mert az
   * import `deleteMany` + `createMany` parossal dolgozik, es az uj sor ures
   * mezovel keletkezik. A FAJL viszont ott marad a lemezen, es a kulcsa az
   * URL-bol jon, tehat valtozatlan.
   *
   * Ezert a masolo eloszor a TAROLOT kerdezi. Enelkul minden import utan ujra
   * letoltene mind a 3426 kepet -- eppen azt a munkat vegezve el ujra, amit a
   * mezo elvesztese csak LATSZOLAG tett szuksegesse.
   */
  if ((await deps.store.get(key)) !== null) {
    await deps.recordStorageKey(image.id, storageKey);
    return "already";
  }

  let response: Response;
  try {
    response = await deps.fetchImpl(image.url);
  } catch (error) {
    return { reason: `a lehívás elhasalt: ${String(error)}` };
  }
  if (!response.ok) return { reason: `HTTP ${response.status}` };

  const bytes = new Uint8Array(await response.arrayBuffer());
  /**
   * AZ URES VALASZ NEM SIKER. Egy nulla bajtos fajl a taroloban ugy nezne ki,
   * mint egy athozott kep, es a hiba a BOLTBAN jelenne meg, egy ures kep
   * helyen. Ilyenkor NEM irunk sem fajlt, sem mezot.
   */
  if (bytes.length === 0) return { reason: "a válasz üres volt (0 bájt)" };

  await deps.store.put(key, bytes);
  await deps.recordStorageKey(image.id, storageKey);
  return "copied";
}

/**
 * A KEPEK ATHOZASA, EGYESEVEL, ES EGY BUKAS NEM ALLITJA MEG A TOBBIT.
 *
 * MIERT NEM ALL MEG: 3426 kepbol egy megszunt URL vagy egy lassu valasz nem
 * indok arra, hogy a maradek se keruljon at. A bukas SORONKENT jelenik meg a
 * jelentesben, es a sor VALTOZATLAN marad -- tehat a kovetkezo futas ujra
 * probalja, magatol.
 */
export async function copyProductImages(
  images: CopyableImage[],
  deps: ImageCopyDeps,
): Promise<ImageCopyOutcome> {
  const outcome: ImageCopyOutcome = {
    copied: 0,
    alreadyStored: 0,
    failed: [],
  };

  for (const image of images) {
    const result = await copyOne(image, deps);
    if (result === "copied") outcome.copied += 1;
    else if (result === "already") outcome.alreadyStored += 1;
    else
      outcome.failed.push({
        imageId: image.id,
        url: image.url,
        reason: result.reason,
      });
  }

  return outcome;
}
