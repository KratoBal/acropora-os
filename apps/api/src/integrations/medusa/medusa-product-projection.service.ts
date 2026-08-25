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
  /**
   * A külső azonosító csak PUHÁN TÖRÖLT terméke(ke)n ül: MEGSZAKADT AZONOSSÁGI
   * LÁNC. Lásd az indoklást a `project` törzsében.
   */
  | "broken-identity-chain"
  /** Több ÉLŐ termék viseli ugyanazt a külső azonosítót. */
  | "ambiguous"
  /** A terméknek nincs cikkszáma, tehát nincs mit változatként átvinni. */
  | "no-sku"
  /**
   * A keresés kimerítette a limitet, tehát lehet több találat is. Csonkolt
   * halmazon nem döntünk: az élők száma ilyenkor nem megbízható.
   */
  | "lookup-truncated";

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

    /**
     * Csonkolt válaszon NEM döntünk. A lista nem rendez, tehát egy kimerített
     * limit nem „az elsőket" adja vissza, hanem tetszőleges részhalmazt - és
     * abból az élők száma bármi lehet. Ez a megállás olcsóbb, mint egy
     * magabiztos rossz ág.
     */
    if (found.truncated)
      return {
        action: "stopped",
        reason: "lookup-truncated",
        details:
          `${product.id}: a keresés kimerítette a limitet (${found.rows.length} sor), ` +
          `tehát lehet több találat is. Csonkolt halmazon nem döntünk.`,
      };

    const live = found.rows.filter((row) => !row.deleted_at);
    const deleted = found.rows.filter((row) => row.deleted_at);

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
     * Csak törölt találat: MEGÁLLUNK, és jelentjük.
     *
     * Balázs döntése, 2026-08-24, szó szerint: „Törölt Medusa rekord plusz
     * nincs élő találat esetén a projection álljon meg ennél a terméknél és
     * jelentse az identity conflictot. Nem hozunk létre újat automatikusan.
     * Nem próbálunk restore-t. Nem skipeljük csendben. Az ok: ez nem ownership
     * konfliktus, hanem MEGSZAKADT AZONOSSÁGI LÁNC."
     *
     * A különbség nem szószépítés. Egy tulajdon-konfliktusnál KÉT JOGOS IGÉNY
     * áll szemben, és dönteni kell közöttük. Itt a láncnak az egyik VÉGE
     * hiányzik: tudjuk, melyik a mi termékünk, és tudjuk, hogy az azonosítója
     * egy eltemetett soron ül, de azt nem tudjuk, mi történt közben. Bármelyik
     * automatikus válasz találgatás lenne.
     *
     * A másik két út egyébként sem járható: létrehozni tilos, mert akkor két
     * termék viselné ugyanazt a külső azonosítót, és ezt a Medusa nem
     * akadályozza meg (nincs egyedi index a mezőn); visszaállítani pedig nem
     * lehet, mert az admin API-n NINCS ilyen művelet.
     */
    if (deleted.length > 0)
      return {
        action: "stopped",
        reason: "broken-identity-chain",
        details:
          `Megszakadt azonossági lánc. Acropora OS termék: ${product.id} ` +
          `(ez egyben a Medusának küldött külső azonosító is). ` +
          `Odaát csak TÖRÖLT termék viseli ezt az azonosítót: ` +
          `${deleted.map((row) => row.id).join(", ")}. ` +
          `Nem hoztunk létre újat és nem állítottunk vissza semmit: ` +
          `ember döntése, hogy a törölt sor sorsa mi legyen.`,
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
          /**
           * ÜRESEN, és ez állítás, nem mulasztás: nem viszünk át árat. A
           * mező azért van itt, mert a Medusa megköveteli; a tartalma azért
           * üres, mert az árazás nem ennek a körnek a dolga.
           */
          prices: [],
        },
      ],
    });
    await this.links.link(product.id, created.id, now);
    return { action: "created", medusaProductId: created.id };
  }
}

/** Csak a teszteknek, hogy a sor alakja egy helyen legyen leírva. */
export type { MedusaProductRow };
