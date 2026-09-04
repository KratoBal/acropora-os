import type { MedusaImageBlockReason } from "@acropora/database";

import {
  detectImageContentType,
  imageFileNameFor,
} from "./image-content-type.js";
import type { DocumentStore } from "../../service-assets/document-store/document-store.js";
import type {
  MedusaAdminClient,
  MedusaUploadedFile,
} from "./medusa-admin.client.js";
import { describeMedusaFailure } from "./medusa-admin.client.js";
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

/**
 * A BESOROLAS ES A MONDAT EGYUTT.
 *
 * A `reason` a Prisma enumja, tehat ugyanaz az ertekkeszlet all a kodban es az
 * adatbazisban -- egy elgepelesre forditasi hiba jon, nem egy sor, ami sehol
 * nem talalhato meg.
 */
export interface ImageBlock {
  reason: MedusaImageBlockReason;
  /** A reszletezo mondat, ugyanaz, ami eddig a kimenetre ment. */
  details: string;
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
   * BESOROLAS ES SZOVEG EGYUTT, es a ketto nem helyettesiti egymast. A szoveg
   * a diagnozis (melyik kep, milyen hiba), az `reason` viszont az, amire
   * SZURNI lehet: a "nincs meg a mester" es az "elhasalt a feltoltes" ket
   * kulonbozo teendo, es egy szabad szoveges mezo ezt a kulonbseget csak
   * addig orzi, amig valaki at nem fogalmazza az egyik mondatot.
   *
   * Ez a mezo 2026-09-04-ig CSAK szoveg volt, es kizarolag a futas kimenetere
   * kerult. Az `reason` azert kell, mert a hivo mostantol a TERMEK sorara is
   * felirja, es egy tarolt szoveg nem kereshetо.
   */
  blockedBy: ImageBlock | null;
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
        blockedBy: {
          reason: "MASTER_MISSING",
          details: `a kép még nincs áthozva a mesterbe (${image.url})`,
        },
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
        blockedBy: {
          reason: "MASTER_CORRUPT",
          details:
            `a tároló-kulcs áll a soron, de a fájl nincs meg ` +
            `(${image.storageKey}) -- a mester sérült`,
        },
      };

    /**
     * A TIPUS A BAJTOKBOL, NEM A MEZOBOL.
     *
     * A hivo `image.contentType` mezoje 2026-09-04-ig KEMENYEN `image/jpeg`
     * volt minden kepre, mert a `ProductImage` soron nincs tipus-mezo -- egy
     * PNG is JPEG-kent ment fel. A bajtok viszont megmondjak.
     *
     * ES HA NEM ISMERJUK FEL, NEM TOLTJUK FEL. Ez VALTOZAS a mai
     * viselkedeshez kepest, es szandekos: egy fel nem ismert bajtsor
     * valoszinuleg nem is kep, es egy nem-kep fajlt kikuldeni a boltba
     * rosszabb, mint kihagyni. A kihagyas HANGOS -- a `blockedBy` sor a
     * jelentesbe kerul, es a termek tobbi mezoje ettol meg kimegy.
     */
    const felismert = detectImageContentType(bytes);
    if (felismert === null)
      return {
        urls: [],
        uploaded,
        reused,
        blockedBy: {
          reason: "NOT_AN_IMAGE",
          details:
            `a fájl tartalma nem ismerhető fel képként (${image.url}) -- ` +
            `nem töltjük fel, mert a típusát nem tudjuk megmondani`,
        },
      };

    let file: MedusaUploadedFile;
    try {
      file = await deps.medusa.uploadFile({
        /**
         * A NEV KITERJESZTESE IS A TARTALOMHOZ IGAZODIK, es ez a MASODIK
         * lehetseges okot celozza: ha a bolt a fajlnevbol dolgozik, egy
         * `.jpg`-re vegzodo PNG ugyanugy rossz tipust kapna.
         */
        filename: imageFileNameFor(image.fileName, felismert),
        content: Buffer.from(bytes),
        contentType: felismert,
      });
    } catch (error) {
      /**
       * A STATUSZ MEGY KI, A TORZS NEM -- ES EZ NEM UJ SZABALY, HANEM EGY MAR
       * MEGLEVO JAVITAS HATOKORE.
       *
       * A `MedusaAdminHttpError` uzenete a valasz elso 500 karakteret is viszi,
       * mert a hibakeresesnel az a hasznos. Ez a szoveg viszont a `blockedBy`
       * mezobe kerul, onnan a parancssori kimenetre, es onnantol nem tudjuk,
       * ki olvassa. A `String(error)` epp ezt engedte at.
       *
       * A megoldas UGYANAZ, amit a keszlet-vetites mar hasznal
       * (`medusa-inventory-projection.service.ts`): minden megnevezett
       * Medusa-hiba a `describeMedusaFailure`-on megy at. Ket kulonbozo alak
       * ugyanarra a hibara rosszabb lenne, mint egy kovetkezetes.
       */
      return {
        urls: [],
        uploaded,
        reused,
        blockedBy: {
          reason: "UPLOAD_FAILED",
          details: `a feltöltés elhasalt (${image.url}): ${describeMedusaFailure(error)}`,
        },
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
