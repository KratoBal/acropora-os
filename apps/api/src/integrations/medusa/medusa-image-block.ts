import type { MedusaImageBlockReason } from "@acropora/database";

import type { ImageBlock } from "./product-image-publisher.js";

/**
 * A KEP-BLOKKOLAS OKA A TERMEK SORARA.
 *
 * === MIERT KULON MODUL ===
 *
 * A kiado (`product-image-publisher.ts`) azt tudja, MI tortent; ez a modul azt,
 * hogy abbol MI KERUL a sorba. A ketto kulon merheto, es a masodik adatbazis
 * nelkul is: egy tiszta fuggveny, ami egy `data` objektumot ad vissza.
 *
 * === AZ OTODIK OK ITT SZULETIK, NEM A KIADOBAN ===
 *
 * A kiado kepenkent dolgozik, tehat a "nincs egyetlen kep-sor sem" allapotot
 * nem is latja: a hivo ilyenkor meg sem hivja meg. Ez a megkulonboztetes
 * viszont pont az, amiert ez az egesz keszul -- ma ez az eset NEMA, a futtato
 * egyetlen sort sem ir ki rola.
 */

/**
 * NINCS KEP-SOR A FORRASBAN.
 *
 * NEM HIBA, es a mondata sem hibat allit. Attol viszont, hogy nem hiba, meg
 * VALASZ: aki azt kerdezi, miert nincs kepe egy termeknek a boltban, ezt a
 * mondatot keresi -- es ma semmit nem talalna.
 */
export const NO_IMAGE_ROW_BLOCK: ImageBlock = {
  reason: "NO_IMAGE_ROW",
  details:
    "a termékhez nincs kép-sor a forrásban: nincs mit kiküldeni, " +
    "ez nem hiba",
};

export interface ImageBlockColumns {
  medusaImageBlockReason: MedusaImageBlockReason | null;
  medusaImageBlockDetails: string | null;
  medusaImageBlockedAt: Date | null;
}

/**
 * A HAROM OSZLOP ERTEKE, EGYUTT.
 *
 * MIND A HARMAT MINDIG IRJUK, es ez a lenyeg: siker eseten NULLAZUNK. Egy
 * ottfelejtett ok ugyanugy hazudna, mint egy elavult komment egy azota bezart
 * lyukrol -- es rosszabb a semminel, mert magabiztosan hazudik.
 *
 * Ezert nem eleg a `reason` nullazasa sem: ha a szoveg vagy az idobelyeg
 * bennmaradna, egy lekerdezes, ami a reszletekre szur, tovabbra is megtalalna
 * a mar megoldott esetet.
 */
export function imageBlockUpdate(
  block: ImageBlock | null,
  now: Date,
): ImageBlockColumns {
  if (!block)
    return {
      medusaImageBlockReason: null,
      medusaImageBlockDetails: null,
      medusaImageBlockedAt: null,
    };

  return {
    medusaImageBlockReason: block.reason,
    medusaImageBlockDetails: block.details,
    medusaImageBlockedAt: now,
  };
}

/**
 * VÁLTOZIK-E A SOR, HA EZT A BLOKKOLÁST ÍRNÁNK RÁ. Tiszta függvény.
 *
 * NEM KOZMETIKA: minden `product.update` hívás a valódi írási idővel frissíti a
 * `Product.updatedAt`-et, és a termék-ütemező ezt FORRÁS-változásnak látja. Ha a
 * futtató minden vetítésnél írna, a vetített termék a következő körben újra
 * esedékes lenne, és az `updatedAt` szerinti sorrend miatt ugyanaz a kötegnyi
 * termék forogna körről körre (mérve a teszt kirakaton 2026-10-07: a 04:34-es és a
 * 05:06-os kör 100 terméke 100/100 azonos volt, a többi ~1400 soha nem került sorra).
 *
 * Az OKOT és a MONDATOT hasonlítjuk, az időpontot nem: változatlan blokkolásnál a
 * meglévő `medusaImageBlockedAt` marad, és így azt jelenti, MIÓTA áll a blokk.
 */
export function imageBlockChanged(
  current: {
    medusaImageBlockReason: MedusaImageBlockReason | null;
    medusaImageBlockDetails: string | null;
  },
  block: ImageBlock | null,
): boolean {
  return (
    current.medusaImageBlockReason !== (block?.reason ?? null) ||
    current.medusaImageBlockDetails !== (block?.details ?? null)
  );
}
