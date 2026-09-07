import { Injectable } from "@nestjs/common";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  describeShippingFlags,
  shippingFlagsDiffer,
  shippingFlagsFromProfile,
  type MedusaShippingFlags,
  type OsShippingProfile,
} from "./medusa-shipping-attributes.policy.js";

/**
 * A SZALLITASI JELLEMZOK ATVITELE A BOLTBA.
 *
 * === AMIT EZ AZ UT LEZAR ===
 *
 * A bolt a kosar szallitasi osztalyat NEGY kimondott zaszlobol szamolja
 * (`pickup_only`, `foxpost_forbidden`, `is_heavy`, `is_frozen`), es ezek a
 * zaszlok termekenkent allnak egy sajat rekordban. Az ertekek az OS-ben
 * keletkeznek (a szallitasi-jellemzok kartya irja oket), es MA SEMMI nem viszi
 * at oket -- a Commerce modell sajat megjegyzese szerint "Acropora OS
 * synchronizes by product id", az OS-ben viszont nulla talalat volt erre.
 */
export type ShippingAttributesOutcome =
  /** Nincs profil-sor: senki nem vizsgalta meg a terméket. Nem irunk. */
  | { action: "skipped"; reason: "no-profile" }
  /** Nincs bolti lekepezes: a termek meg nincs kint. Nem irunk. */
  | { action: "skipped"; reason: "no-link" }
  /** A bolti allapot MAR egyezett. Nem irtunk, es ezt ki is mondjuk. */
  | { action: "unchanged"; medusaProductId: string; flags: string }
  /** Kikuldtuk. */
  | { action: "applied"; medusaProductId: string; flags: string }
  /** Proba-futas: ezt kuldtuk VOLNA. */
  | { action: "planned"; medusaProductId: string; flags: string };

@Injectable()
export class MedusaShippingAttributesService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
  ) {}

  /**
   * EGY TERMEK ATVITELE.
   *
   * A `profile` a HIVOTOL jon, nem innen kerdezzuk le: a lekerdezes a
   * futtatoban all, a dontes itt, es igy a dontes adatbazis nelkul merheto.
   *
   * A `apply` HAMIS az alapertelmezes, es ez nem ovatoskodas: ez a parancs a
   * BOLTBA ir, es egy iras, ami veletlenul indul el, nem vonhato vissza egy
   * ujrafuttatassal -- a regi ertekeket mar senki nem tudja.
   */
  async project(
    osProductId: string,
    profile: OsShippingProfile | null,
    apply: boolean,
  ): Promise<ShippingAttributesOutcome> {
    if (!profile) return { action: "skipped", reason: "no-profile" };

    const link = await this.links.findByProductId(osProductId);
    if (!link) return { action: "skipped", reason: "no-link" };

    const wanted: MedusaShippingFlags = shippingFlagsFromProfile(profile);
    const leiras = describeShippingFlags(wanted);

    /**
     * A JELENLEGI ALLAPOT LEKERDEZESE -- ES EZ NEM SPOROLAS.
     *
     * A parancs kimenete csak akkor bizonyit, ha meg tudja mondani, MI
     * TORTENT. A WYSIWYG szabalynal ezt megmertuk: az EREDMENY onmagaban
     * semmit nem bizonyitott, mert a bolt alapertelmezese ugyanaz volt, mint a
     * szandekunk -- a "mar igy allt" es a "most allitottuk be" KULONBSEGE
     * volt a bizonyitek.
     */
    const current = await this.medusa.fetchShippingAttributes(
      link.medusaProductId,
    );
    if (!shippingFlagsDiffer(current, wanted))
      return {
        action: "unchanged",
        medusaProductId: link.medusaProductId,
        flags: leiras,
      };

    if (!apply)
      return {
        action: "planned",
        medusaProductId: link.medusaProductId,
        flags: leiras,
      };

    await this.medusa.setShippingAttributes(link.medusaProductId, wanted);
    return {
      action: "applied",
      medusaProductId: link.medusaProductId,
      flags: leiras,
    };
  }
}
