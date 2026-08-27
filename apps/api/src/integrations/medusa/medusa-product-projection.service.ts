import { Injectable } from "@nestjs/common";

import type {
  MedusaAdminClient,
  MedusaProductRow,
  MedusaSalesChannelRow,
} from "./medusa-admin.client.js";
import { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  decidePublication,
  PUBLICATION_REASON_TEXT,
  type ProductPublicationState,
  type PublicationDecision,
} from "./medusa-publication.policy.js";

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
  /**
   * A vetítendő változat cikkszáma, vagy `null`, ha nincs.
   *
   * A HÍVÓ SZERZŐDÉSE, és ki van írva, mert az adatbázisban a `sku` oszlop NEM
   * nullázható (`sku String @unique`). Vagyis a `null` itt sosem azt jelenti,
   * hogy „van változat, de nincs cikkszáma" - azt jelenti, hogy a hívó nem
   * TALÁLT olyan változatot, amit átvinne. A parancssori felület az AKTÍV
   * változatok közül veszi az elsőt.
   */
  primarySku: string | null;
  /**
   * A publikációs döntés BEMENETE, nem a döntés.
   *
   * Szándékosan az állapot utazik és nem a kész döntés: így a szabályt a
   * szolgáltatás alkalmazza, és a hívó nem tudja kihagyni. Egy parancssori
   * felület, ami maga döntene, egy nap másképp döntene.
   */
  publication: ProductPublicationState;
}

export type ProjectionOutcome =
  /** Nem volt odaát, létrehoztuk, és rögzítettük a leképezést. */
  | {
      action: "created";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Volt leképezés, a meglévő terméket módosítottuk. */
  | {
      action: "updated";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Nem volt leképezés, de a külső azonosító megtalálta az ÉLŐ terméket. */
  | {
      action: "relinked";
      medusaProductId: string;
      publication: ProjectionPublicationReport;
    }
  /** Nem lehet folytatni, és megmondjuk, miért. */
  | { action: "stopped"; reason: ProjectionStopReason; details: string };

/** Amit a jelentés a publikációs oldalról kiír. */
export interface ProjectionPublicationReport {
  status: PublicationDecision["status"];
  salesChannel: PublicationDecision["salesChannel"];
  reason: string;
  /**
   * Melyik csatornára írtunk, és mi a NEVE.
   *
   * Kiírjuk, nem állítjuk. Egy rossz, de létező azonosítót az vesz észre, aki
   * a jelentést olvassa - és nem egy ellenőrzés, ami egy jogos átnevezésre is
   * pirosodna.
   */
  salesChannelName: string;
}

export type ProjectionStopReason =
  /**
   * A külső azonosító csak PUHÁN TÖRÖLT terméke(ke)n ül: MEGSZAKADT AZONOSSÁGI
   * LÁNC. Lásd az indoklást a `project` törzsében.
   */
  | "broken-identity-chain"
  /** Több ÉLŐ termék viseli ugyanazt a külső azonosítót. */
  | "ambiguous"
  /**
   * A hívó nem adott átvihető cikkszámot, tehát nincs mit változatként
   * átvinni.
   *
   * A NEVE SZÁNDÉKOSAN NEM „nincs cikkszáma": a `sku` oszlop nem nullázható,
   * tehát a termékNEK lehet cikkszáma - csak nem olyan változaton, amit a
   * hívó átvinne. A pontos okot az tudja, aki a lekérdezést futtatta; a
   * szolgáltatás csak azt tudja, hogy nem kapott értéket, és csak ezt is
   * állítja.
   */
  | "no-sku"
  /**
   * A keresés kimerítette a limitet, tehát lehet több találat is. Csonkolt
   * halmazon nem döntünk: az élők száma ilyenkor nem megbízható.
   */
  | "lookup-truncated"
  /**
   * Nincs beállítva a storefront csatorna azonosítója.
   *
   * MEGÁLLUNK, és nem "óvatoskodunk". A csatorna-kötésnek három alakja van, és
   * kettő közülük kívülről egyformán néz ki: ha a mezőt elhagynánk, a linkek
   * érintetlenül maradnának, miközben a status átáll - félkész állapot. Ha
   * üres listát küldenénk, az egy LEKÖTÉS, amit egy hét múlva senki nem tud
   * megkülönböztetni egy szándékos döntéstől. Mindkét óvatos alak rosszabb a
   * hibánál.
   */
  | "sales-channel-not-configured"
  /**
   * A beállított csatorna azonosítója nem létezik a cél oldalon.
   *
   * Ez az az eset, amit egy környezetből a másikba átörökölt beállítás
   * okoz. Az ELSŐ használatkor derül ki, egyszer, nem minden hívásnál - és
   * ez a jó pillanat: egy termék, ami nem jelenik meg a boltban, sokkal
   * később és sokkal drágábban mondaná el ugyanezt.
   */
  | "sales-channel-not-found";

/**
 * MIÉRT nincs átvihető cikkszám - és a szolgáltatás EZT MEG TUDJA MONDANI.
 *
 * Az első változatom azt írta, hogy „a terméknek nincs cikkszáma". Ezt innen
 * nem lehet tudni, és ráadásul NEM IGAZ: az adatbázisban a `sku` oszlop nem
 * nullázható (`sku String @unique`), tehát a termékNEK lehet cikkszáma. A
 * mondat egy olyan állapotot nevezett meg, ami elő sem állhat, és a teendőre is
 * rosszul mutatott: cikkszámot kerestetett, ahelyett hogy változatot
 * aktiváltatna.
 *
 * A PONTOS OK VISZONT ITT VAN, plumbing nélkül: az `activeVariantCount` már
 * megérkezik a publikációs bemenetben, ugyanabból a lekérdezésből. A két mező
 * együtt eldönti, melyik eset áll fenn - és a MÁSODIK eset (aktív változat van,
 * cikkszám mégsem jött) a hívó szerződésszegése, amit szintén meg kell
 * nevezni, nem elhallgatni.
 */
function describeMissingSku(product: ProjectableProduct): string {
  if (product.publication.activeVariantCount === 0)
    return (
      `${product.id}: nincs AKTÍV változata, ezért nincs átvihető cikkszám. ` +
      `Ez NEM cikkszám-hiány: a mező nem nullázható, tehát a terméknek lehet ` +
      `inaktív változata cikkszámmal. A teendő egy változat aktiválása.`
    );

  return (
    `${product.id}: a hívó ${product.publication.activeVariantCount} aktív ` +
    `változatot jelzett, elsődleges cikkszámot mégsem adott. Ez ellentmondó ` +
    `bemenet, nem termék-állapot: a hívót kell megnézni.`
  );
}

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
    /**
     * A storefront csatorna azonosítója, vagy `null`, ha nincs beállítva.
     *
     * Konstruktor-paraméter és nem futásidejű környezet-olvasás, hogy a
     * "hiányzó beállításnál megállunk" tulajdonság hálózat nélkül mérhető
     * legyen.
     */
    private readonly storefrontSalesChannelId: string | null,
  ) {}

  /** Az első használatkor kérdezzük le, utána a folyamat élettartamára tartjuk. */
  private resolvedChannel: MedusaSalesChannelRow | null | undefined;

  private async resolveSalesChannel(): Promise<MedusaSalesChannelRow | null> {
    if (this.resolvedChannel !== undefined) return this.resolvedChannel;
    this.resolvedChannel = await this.medusa.findSalesChannel(
      this.storefrontSalesChannelId!,
    );
    return this.resolvedChannel;
  }

  async project(
    product: ProjectableProduct,
    now: Date,
  ): Promise<ProjectionOutcome> {
    if (!product.primarySku)
      return {
        action: "stopped",
        reason: "no-sku",
        details: describeMissingSku(product),
      };

    if (!this.storefrontSalesChannelId)
      return {
        action: "stopped",
        reason: "sales-channel-not-configured",
        details:
          `${product.id}: nincs beállítva a storefront csatorna azonosítója. ` +
          `Nem küldtünk semmit: sem státuszt, sem csatorna-műveletet. ` +
          `A csatorna elhagyása félkész állapotot hagyna, az üres lista pedig ` +
          `lekötésnek látszana, és egyik sem különböztethető meg utólag egy ` +
          `szándékos döntéstől.`,
      };

    /**
     * A csatorna LÉTEZÉSE egyszer, az első használatkor.
     *
     * Nem minden hívásnál: az azonosító nem változik futás közben. Az első
     * használat viszont a legkorábbi pillanat, amikor egy átörökölt vagy
     * elgépelt beállítás kiderülhet.
     */
    const channel = await this.resolveSalesChannel();
    if (!channel)
      return {
        action: "stopped",
        reason: "sales-channel-not-found",
        details:
          `${product.id}: a beállított storefront csatorna ` +
          `(${this.storefrontSalesChannelId}) nem létezik a cél oldalon. ` +
          `A csatorna azonosítója KÖRNYEZETENKÉNTI érték: a stage azonosítója ` +
          `az élesen nem létezik. Nem küldtünk semmit.`,
      };

    const publication = decidePublication(product.publication);
    /**
     * Amit a jelentés kiír. A brief 11. tesztje ezt követeli: a felület
     * mondja meg, publikáció és csatorna szinten MIT változtatott. Egy
     * "kész" sor önmagában nem mondja meg, mi lett a termékkel.
     */
    const report: ProjectionPublicationReport = {
      status: publication.status,
      salesChannel: publication.salesChannel,
      reason: PUBLICATION_REASON_TEXT[publication.reason],
      salesChannelName: channel.name,
    };
    const salesChannels =
      publication.salesChannel === "attach"
        ? [{ id: this.storefrontSalesChannelId }]
        : [];

    const existingLink = await this.links.findByProductId(product.id);
    if (existingLink) {
      /**
       * A státusz és a csatorna EGY kérésben megy, és ez nem tömörítés.
       * Két kérésben lenne egy pillanat, amikor az egyik már átállt, a másik
       * még nem - és a storefront a KETTŐ metszetét nézi, tehát a félkész
       * állapot pont úgy néz ki, mint egy sikeres váltás.
       */
      await this.medusa.update(existingLink.medusaProductId, {
        title: product.name,
        description: product.description,
        external_id: product.id,
        status: publication.status,
        sales_channels: salesChannels,
      });
      await this.links.link(product.id, existingLink.medusaProductId, now);
      return {
        action: "updated",
        medusaProductId: existingLink.medusaProductId,
        publication: report,
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
      return { action: "relinked", medusaProductId, publication: report };
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
      status: publication.status,
      sales_channels: salesChannels,
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
    return {
      action: "created",
      medusaProductId: created.id,
      publication: report,
    };
  }
}

/** Csak a teszteknek, hogy a sor alakja egy helyen legyen leírva. */
export type { MedusaProductRow };
