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
