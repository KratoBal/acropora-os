import { Injectable } from "@nestjs/common";

import type {
  MedusaAdminClient,
  MedusaProductRow,
} from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";

/**
 * Egy termék vetítése az Acropora OS-ből a Medusába.
 *
 * A kör egyetlen kérdése nem az, hogy MELY MEZŐK mennek át, hanem hogy a
 * futtatás MEGISMÉTELHETŐ-e. Ezért a szolgáltatás magja a döntés, nem az írás.
 */

export interface ProjectableProduct {
  id: string;
  name: string;
  description: string | null;
  primarySku: string | null;
}

export type ProjectionOutcome =
  /** Nem volt odaát, létrehoztuk, és rögzítettük a leképezést. */
  | { action: "created"; medusaProductId: string }
  /** Volt leképezés, a meglévő terméket módosítottuk. */
  | { action: "updated"; medusaProductId: string }
  /** Nem volt leképezés, de a külső azonosító megtalálta az ÉLŐ terméket. */
  | { action: "relinked"; medusaProductId: string }
  /** Nem lehet folytatni, és megmondjuk, miért. */
  | { action: "stopped"; reason: ProjectionStopReason; details: string };

export type ProjectionStopReason =
  /** A külső azonosító csak PUHÁN TÖRÖLT terméke(ke)n ül. */
  | "only-deleted"
  /** Több ÉLŐ termék viseli ugyanazt a külső azonosítót. */
  | "ambiguous"
  /** A terméknek nincs cikkszáma, tehát nincs mit változatként átvinni. */
  | "no-sku";

/**
 * Az egyetlen opció, amit a Medusa megkövetel.
 *
 * A séma szerint csak a cím kötelező, a MUNKAFOLYAMAT viszont megtagadja az
 * opció nélküli terméket. Egy egyváltozatos terméknek is kell legalább egy
 * opció, tehát adunk neki egyet. Ez nem üzleti fogalom, hanem a cél oldali
 * modell kötelező eleme, és a neve is ezt mondja.
 */
const DEFAULT_OPTION_TITLE = "Kivitel";
const DEFAULT_OPTION_VALUE = "Alap";

@Injectable()
export class MedusaProductProjectionService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
  ) {}

  async project(
    product: ProjectableProduct,
    now: Date,
  ): Promise<ProjectionOutcome> {
    if (!product.primarySku)
      return {
        action: "stopped",
        reason: "no-sku",
        details: `${product.id}: a terméknek nincs cikkszáma`,
      };

    const existingLink = await this.links.findByProductId(product.id);
    if (existingLink) {
      await this.medusa.update(existingLink.medusaProductId, {
        title: product.name,
        description: product.description,
        external_id: product.id,
      });
      await this.links.link(product.id, existingLink.medusaProductId, now);
      return {
        action: "updated",
        medusaProductId: existingLink.medusaProductId,
      };
    }

    /**
     * Nincs leképezés. Ez NEM hibaállapot: az első éles betöltés normál
     * állapota. Mielőtt bármit létrehoznánk, meg kell nézni, nem áll-e már
     * odaát a mi külső azonosítónk - különben egy elveszett leképezés minden
     * futásnál új terméket szülne.
     */
    const found = await this.medusa.findByExternalId(product.id);
    const live = found.filter((row) => !row.deleted_at);
    const deleted = found.filter((row) => row.deleted_at);

    /**
     * A SZÁMLÁLÁS AZ ÉLŐKRE MEGY, nem a nyers sorokra. Egy törölt és egy élő
     * termék ugyanazzal a külső azonosítóval hétköznapi állapot: pont az áll
     * elő, ha valamit törölnek és ugyanaz az azonosító újra bekerül. Ilyenkor
     * az élő számít, a törölt sor történelem.
     */
    if (live.length >= 2)
      return {
        action: "stopped",
        reason: "ambiguous",
        details: `${product.id}: több élő Medusa-termék viseli ugyanezt az azonosítót: ${live
          .map((row) => row.id)
          .join(", ")}`,
      };

    if (live.length === 1) {
      const medusaProductId = live[0]!.id;
      await this.links.link(product.id, medusaProductId, now);
      return { action: "relinked", medusaProductId };
    }

    /**
     * Csak törölt találat. Létrehozni TILOS: akkor két termék viselné ugyanazt
     * a külső azonosítót, és ezt a Medusa nem akadályozza meg, mert a mezőn
     * nincs egyedi index. Visszaállítani nem lehet: az admin API-n nincs ilyen
     * művelet, a `restoreProducts` csak a törlés kompenzációjaként létezik.
     *
     * Marad a megállás. Ez a legszigorúbb a három lehetséges válasz közül, és
     * szándékosan az: ez a visszavonható. Ha a döntés más lesz, egy elágazás
     * cseréje. A mai stage-en egyébként nulla puhán törölt termék van, tehát
     * ez az ág ma nem is érhető el.
     */
    if (deleted.length > 0)
      return {
        action: "stopped",
        reason: "only-deleted",
        details: `${product.id}: az azonosító csak törölt terméke(ke)n áll: ${deleted
          .map((row) => row.id)
          .join(", ")}`,
      };

    const created = await this.medusa.create({
      title: product.name,
      description: product.description,
      external_id: product.id,
      options: [
        { title: DEFAULT_OPTION_TITLE, values: [DEFAULT_OPTION_VALUE] },
      ],
      variants: [
        {
          title: product.name,
          sku: product.primarySku,
          options: { [DEFAULT_OPTION_TITLE]: DEFAULT_OPTION_VALUE },
        },
      ],
    });
    await this.links.link(product.id, created.id, now);
    return { action: "created", medusaProductId: created.id };
  }
}

/** Csak a teszteknek, hogy a sor alakja egy helyen legyen leírva. */
export type { MedusaProductRow };
