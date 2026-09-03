import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import type {
  MedusaAdminClient,
  MedusaUploadedFile,
} from "./medusa-admin.client.js";
import type { MedusaImageLinkRepository } from "./medusa-image-link.repository.js";
import { productImageDocumentId } from "./product-image-storage-key.js";

/**
 * A KEPEK ELJUTNAK A KIRAKATBA.
 *
 * A LANC NEGYEDIK LABA, es nem uj kepesseg: a masik harom osszekotese. A
 * masolo (a mester) mar a mi tarolonkban tartja a bajtokat, a kliens tud
 * feltolteni, a lekepezes emlekszik -- ez a modul a menetrend.
 *
 * TERMEKENKENT DOLGOZIK, NEM KEPENKENT, es ez NEM kenyelmi bontas. A vetites a
 * termek OSSZES kepet egyszerre kuldi, es a cel oldalon a mezo
 * CSERE-szemantikaju: egy felig feltoltott termek listaja LETOROLNE a tobbi
 * kepet a boltban. Ezert egy termek vagy TELJESEN atmegy, vagy a kep-listaja
 * egyaltalan nem megy ki.
 */

export interface PublishableImage {
  /** A mi `ProductImage` sorunk azonositoja -- csak a jelentesbe kerul. */
  id: string;
  /** A FORRAS URL-je. Ez a lekepezes kulcsanak resze, nem a feltoltese. */
  url: string;
  /** A tarolo-kulcs; `null`, ha a kep meg nincs athozva a mesterbe. */
  storageKey: string | null;
  /** A fajlnev, ahogy a bolt taroloja latni fogja. */
  fileName: string;
  contentType: string;
}

export interface PublishOutcome {
  /** A bolti URL-ek, a bemeneti SORRENDBEN. Ures, ha a termek nem mehet. */
  urls: string[];
  uploaded: number;
  /** Mar fent volt: a lekepezes megtalalta. */
  reused: number;
  /**
   * MIERT NEM MEHET A TERMEK. `null`, ha mehet.
   *
   * Egy szoveg, nem logikai ertek: a hivo jelentesbe irja, es a "nincs meg a
   * mester" es a "elhasalt a feltoltes" KET kulonbozo teendo.
   */
  blockedBy: string | null;
}

export interface PublishDeps {
  store: DocumentStore;
  medusa: Pick<MedusaAdminClient, "uploadFile">;
  links: Pick<MedusaImageLinkRepository, "findByImage" | "link">;
  now: Date;
}

/**
 * EGY TERMEK KEPEINEK KIVITELE.
 *
 * A SORREND A BEMENETE: a hivo mar rendezte (`sortOrder`), es a cel oldalon a
 * tomb sorrendje adja a rangot. Egy atrendezes itt CSENDBEN mas fo kepet
 * eredmenyezne.
 */
export async function publishProductImages(
  productId: string,
  images: PublishableImage[],
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const urls: string[] = [];
  let uploaded = 0;
  let reused = 0;

  for (const image of images) {
    /**
     * A MESTER HIANYA MEGALLITJA AZ EGESZ TERMEKET.
     *
     * Nem hagyjuk ki a kepet es nem toltjuk fel a tobbit: egy hianyos lista a
     * cel oldalon TOROLNE a mar kint levo kepeket. A hianyzo mester a masolo
     * dolga, es amig nincs meg, ez a termek varjon.
     */
    if (image.storageKey === null)
      return {
        urls: [],
        uploaded,
        reused,
        blockedBy: `a kép még nincs áthozva a mesterbe (${image.url})`,
      };

    const existing = await deps.links.findByImage(productId, image.url);
    if (existing) {
      urls.push(existing.medusaUrl);
      reused += 1;
      continue;
    }

    const bytes = await deps.store.get({
      owner: "product",
      ownerId: productId,
      documentId: productImageDocumentId(image.url),
    });
    /**
     * A `storageKey` AZT ALLITJA, hogy a fajl ott van -- ez viszont MEGNEZI.
     *
     * A ketto elterhet: a sor a mienk, a fajl a lemezen. Egy `null` itt azt
     * jelenti, hogy a mezo HAZUDIK (torolt fajl, elveszett kotet), es ez
     * KULON teendo: nem ujra feltolteni kell, hanem a mestert helyreallitani.
     */
    if (bytes === null)
      return {
        urls: [],
        uploaded,
        reused,
        blockedBy:
          `a tároló-kulcs áll a soron, de a fájl nincs meg ` +
          `(${image.storageKey}) -- a mester sérült`,
      };

    let file: MedusaUploadedFile;
    try {
      file = await deps.medusa.uploadFile({
        filename: image.fileName,
        content: Buffer.from(bytes),
        contentType: image.contentType,
      });
    } catch (error) {
      return {
        urls: [],
        uploaded,
        reused,
        blockedBy: `a feltöltés elhasalt (${image.url}): ${String(error)}`,
      };
    }

    /**
     * A LEKEPEZES A FELTOLTES UTAN, ES EZ A MASOLO SORREND-SZABALYANAK A
     * FOLYTATASA: eloszor a tartos dolog (a bolti fajl), utana a hivatkozo.
     * Forditva egy elhasalt feltoltes utan olyan lekepezes maradna, ami egy
     * nem letezo fajlra mutat -- es a kovetkezo futas azt hinne, kesz.
     */
    await deps.links.link(productId, image.url, file.id, file.url, deps.now);
    urls.push(file.url);
    uploaded += 1;
  }

  return { urls, uploaded, reused, blockedBy: null };
}
