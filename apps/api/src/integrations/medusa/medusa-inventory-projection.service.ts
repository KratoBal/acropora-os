import { Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import {
  describeMedusaFailure,
  STOCK_LOCATION_LOOKUP_LIMIT,
  type MedusaAdminClient,
  type MedusaInventoryLevelRow,
  type MedusaVariantRow,
} from "./medusa-admin.client.js";
import type { MedusaProductLinkRepository } from "./medusa-product-link.repository.js";
import {
  decideInventoryProjection,
  MedusaInventoryQuantityError,
} from "./medusa-inventory.policy.js";

/**
 * Egy termék készletének vetítése az Acropora OS-ből a Medusába.
 *
 * AZ ACROPORA OS AZ IGAZSÁGFORRÁS, a Medusa storefront vetítés. Visszaszinkron
 * nincs, és nem is épül.
 *
 * MELYIK SZÁMOT KÜLDJÜK, ÉS MIÉRT - mert ez a kör legkönnyebben félreérthető
 * pontja. Az OS `onHand - reserved` értékét küldjük `stocked_quantity`-ként. A
 * Medusa oldalán az `available_quantity` SZÁMÍTOTT mező (`stocked - reserved`),
 * és a `reserved_quantity` a Medusa SAJÁT foglalásaiból áll elő. Vagyis a két
 * rendszer foglalás-fogalma EGYMÁSRA RAKÓDIK: egy medusai kosár-foglalás még
 * egyszer levonódik abból, amiből az OS foglalása már levonódott.
 *
 * Ez NEM HIBA, hanem következmény, és szándékosan így marad: a `stocked` az
 * egyetlen ÍRHATÓ mező, tehát nincs olyan alak, amiben a két foglalás ne
 * rakódna egymásra. A választás nem „levonjuk-e kétszer", hanem „mi legyen a
 * bolt kiindulópontja" - és a helyes kiindulópont az, amit az OS ma is a
 * webshopnak jelent.
 */

export interface ProjectableStock {
  /** Az Acropora OS termékazonosítója. Ez a Medusa `external_id` értéke is. */
  osProductId: string;
  /** A változat cikkszáma. A Medusa oldali változatot ezzel találjuk meg. */
  sku: string;
  onHand: Prisma.Decimal;
  reserved?: Prisma.Decimal | null;
  /**
   * ELORE RENDELHETO-E. Hianyzo ertek eseten a MAI viselkedes all
   * (`PROJECTED_ALLOW_BACKORDER`, azaz `true`).
   *
   * A DONTES ERKEZIK IDE, NEM A KATEGORIAK: ez a szolgaltatas szandekosan nem
   * tud a kategoria-farol. A WYSIWYG szabaly a `medusa-wysiwyg.policy.ts`
   * modulban all, es a parancs szamolja ki, mielott idehiv.
   */
  allowBackorder?: boolean;
}

export interface InventoryProjectionReport {
  sku: string;
  onHand: string;
  reserved: string;
  availableToSell: string;
  medusaQuantity: number;
  /** A Medusa oldali foglalás, ha a válasz hozta. `null`, ha nem. */
  medusaReserved: number | null;
  locationId: string;
  locationName: string;
  inventoryItemId: string;
  variantId: string;
  clamped: boolean;
  fractionDropped: boolean;
  backorder: boolean;
  /** Írtunk-e ténylegesen, és mit. */
  levelResult: "created" | "updated" | "unchanged";
  backorderResult: "set" | "unchanged";
}

export type InventoryProjectionStopReason =
  /** Nincs beállítva a storefront csatorna azonosítója. */
  | "sales-channel-not-configured"
  /**
   * A termékhez nincs Medusa-leképezés.
   *
   * NEM hoz létre terméket: a termék-vetítés külön kör és külön felelősség. A
   * készlet-vetítés csak arra ír, ami már odaát van.
   */
  | "no-product-link"
  /**
   * A csatornához nem PONTOSAN EGY készlethely tartozik.
   *
   * FAIL-CLOSED, mindkét irányban. A nulla azt jelenti, hogy rossz csatornát
   * néztünk (vagy a csatornához nincs hely kötve); a több pedig üzleti döntés:
   * melyik hely készlete a webshopé. Egyiket sem a kód dönti el, és egyik
   * esetben sem írunk semmit.
   */
  | "stock-location-not-resolved"
  /**
   * A változat-keresés kimerítette a limitet, tehát lehet több változat is.
   *
   * Csonkolt halmazon nem döntünk, ugyanazzal az indokkal, mint a
   * termék-keresésnél: a lista nem rendez, tehát a hiányzó egyezésből NEM
   * következik, hogy nincs ilyen cikkszámú változat - csak az, hogy ebben a
   * részhalmazban nem volt.
   */
  | "variant-lookup-truncated"
  /** A Medusa terméken nincs ilyen cikkszámú változat, sem élő, sem eltemetett. */
  | "variant-not-found"
  /**
   * A cikkszám egy PUHÁN TÖRÖLT változaton ül, és élő találat nincs.
   *
   * Ez MEGSZAKADT AZONOSSÁGI LÁNC, nem hiányzó változat, és Balázs döntése
   * (2026-08-27) szerint ugyanaz a szabály áll rá, mint a termékeknél: nem
   * hozunk létre újat, nem állítunk vissza, megállunk és jelentünk.
   *
   * AMIÉRT EZT KI KELL MONDANI, ÉS NEM KÖVETKEZIK A TERMÉK-SZABÁLYBÓL: ott a
   * korlát TECHNIKAI volt - az `external_id` mezőn nincs egyedi index, tehát
   * két élő termék viselhetné ugyanazt az azonosítót. Itt a cikkszám indexe
   * RÉSZLEGES (`deleted_at IS NULL`), tehát a Medusa MEGENGEDNÉ az újra
   * kiosztást, és a létrehozás nem futna hibára. A megállás tehát ÜZLETI
   * döntés, nem technikai kényszer - és egy későbbi index-változtatás NEM
   * oldja fel magától.
   */
  | "variant-identity-chain-broken"
  /** Több változat viseli ugyanazt a cikkszámot ugyanazon a terméken. */
  | "ambiguous-variant"
  /**
   * EGY OLVASÓ Medusa-hívás elhasalt.
   *
   * Ugyanaz a név, mint a termék-vetítésben, és ugyanazért: egy olvasás
   * bukásánál BIZTOSAN nem változott semmi odaát. Az írás bukásának külön
   * neve van (`medusa-write-failed`), mert ott ezt NEM tudjuk.
   */
  | "medusa-read-failed"
  /** A változat nem készletkezelt, tehát nincs mit vetíteni rá. */
  | "inventory-not-managed"
  /**
   * A válasz NEM HOZTA a készlet-láncot.
   *
   * Ez nem ugyanaz, mint hogy nincs kapcsolat: a hiányzó mező azt jelenti,
   * hogy másképp kell kérdezni. Az üres listaként olvasás azt ÁLLÍTANÁ, hogy
   * nincs inventory item, és a vetítés csendben rossz ágra menne.
   */
  | "inventory-chain-missing"
  /** A változathoz nincs inventory item. */
  | "no-inventory-item"
  /** A változathoz több inventory item tartozik: azonossági kérdés. */
  | "ambiguous-inventory-item"
  /** A mennyiség nem ábrázolható pontosan. Lásd a szabály modulját. */
  | "quantity-not-representable"
  /**
   * A Medusa visszautasított egy írást.
   *
   * A részletek MEGNEVEZIK, mi állt be és mi nem. Nem állítunk atomicitást:
   * több hívás kell, és a félállapot valóságos.
   */
  | "medusa-write-failed";

export type InventoryProjectionOutcome =
  | {
      action: "created" | "updated" | "no-change";
      report: InventoryProjectionReport;
    }
  | {
      action: "stopped";
      reason: InventoryProjectionStopReason;
      details: string;
    };

@Injectable()
export class MedusaInventoryProjectionService {
  constructor(
    private readonly links: MedusaProductLinkRepository,
    private readonly medusa: MedusaAdminClient,
    /**
     * A storefront csatorna azonosítója, vagy `null`, ha nincs beállítva.
     *
     * A KÉSZLETHELY NEM ITT ÁLL, és ez szándékos: a helyet minden futáskor a
     * csatorna felől kérdezzük vissza. Egy beégetett vagy beállított
     * készlethely-azonosító ugyanazt a bajt hozná vissza, amit a
     * környezetenkénti csatorna-azonosítónál már ismerünk - csak csendben,
     * mert egy rossz helyre írt készlet a Medusa szerint érvényes művelet.
     */
    private readonly storefrontSalesChannelId: string | null,
  ) {}

  /**
   * A készlethely FUTÁSIDŐBEN, a csatorna felől - és a folyamat élettartamára
   * megjegyezve, mert több termék egy futásban ugyanazt a helyet használja.
   */
  private resolvedLocation:
    { id: string; name: string } | { error: string } | undefined;

  private async resolveLocation(): Promise<
    { id: string; name: string } | { error: string }
  > {
    if (this.resolvedLocation !== undefined) return this.resolvedLocation;

    const locations = await this.medusa.listStockLocationsForSalesChannel(
      this.storefrontSalesChannelId!,
    );

    if (locations.length === 1)
      this.resolvedLocation = {
        id: locations[0]!.id,
        name: locations[0]!.name,
      };
    else if (locations.length === 0)
      this.resolvedLocation = {
        error:
          `a(z) ${this.storefrontSalesChannelId} csatornához EGY készlethely ` +
          `sem tartozik. Vagy rossz csatornát nézünk, vagy a csatornához ` +
          `nincs hely kötve. Nem írtunk semmit.`,
      };
    else
      this.resolvedLocation = {
        error:
          `a(z) ${this.storefrontSalesChannelId} csatornához ` +
          `${locations.length >= STOCK_LOCATION_LOOKUP_LIMIT ? "legalább " : ""}` +
          `${locations.length} készlethely tartozik: ${locations
            .map((row) => `${row.id} (${row.name})`)
            .join(", ")}. Melyik hely készlete a webshopé, az üzleti döntés, ` +
          `nem a kódé. Nem írtunk semmit.`,
      };

    return this.resolvedLocation;
  }

  async project(stock: ProjectableStock): Promise<InventoryProjectionOutcome> {
    if (!this.storefrontSalesChannelId)
      return {
        action: "stopped",
        reason: "sales-channel-not-configured",
        details:
          `${stock.osProductId}: nincs beállítva a storefront csatorna ` +
          `azonosítója, tehát a készlethelyet sem tudjuk visszakérdezni. ` +
          `Nem írtunk semmit.`,
      };

    const link = await this.links.findByProductId(stock.osProductId);
    if (!link)
      return {
        action: "stopped",
        reason: "no-product-link",
        details:
          `${stock.osProductId}: nincs Medusa-leképezés ehhez a termékhez. ` +
          `Előbb a termék-vetítés fusson le (medusa:project). A ` +
          `készlet-vetítés terméket nem hoz létre: az külön felelősség.`,
      };

    let location: { id: string; name: string } | { error: string };
    try {
      location = await this.resolveLocation();
    } catch (error) {
      /**
       * A HIBÁT ITT KAPJUK EL, NEM A `resolveLocation` BELSEJÉBEN, és ez a
       * különbség a futás egészét érinti.
       *
       * A `resolveLocation` a válaszát MEGJEGYZI a folyamat élettartamára,
       * mert több termék ugyanazt a helyet használja. Ha a HTTP-hibából odabent
       * `{ error }` verdikt lenne, azt is megjegyeznénk - és egy pillanatnyi
       * hálózati hiba az EGÉSZ futást megmérgezné: minden további termék
       * ugyanazt a megállást kapná, holott a második hívás már sikerülne.
       *
       * Kívülről elkapva a gyorsítótár érintetlen marad, tehát a következő
       * termék újra megkérdezi.
       */
      return {
        action: "stopped",
        reason: "medusa-read-failed",
        details:
          `${stock.osProductId}: a készlethely lekérdezése elhasalt ` +
          `(${describeMedusaFailure(error)}). Nem írtunk semmit.`,
      };
    }
    if ("error" in location)
      return {
        action: "stopped",
        reason: "stock-location-not-resolved",
        details: `${stock.osProductId}: ${location.error}`,
      };

    let found: Awaited<ReturnType<MedusaAdminClient["listProductVariants"]>>;
    try {
      found = await this.medusa.listProductVariants(link.medusaProductId);
    } catch (error) {
      return {
        action: "stopped",
        reason: "medusa-read-failed",
        details:
          `${stock.osProductId}: a változat-keresés elhasalt a ` +
          `${link.medusaProductId} terméken (${describeMedusaFailure(error)}). ` +
          `Nem írtunk semmit, és nem is döntöttünk: egy sikertelen keresésből ` +
          `NEM következik, hogy a cikkszám nincs odaát.`,
      };
    }

    if (found.truncated)
      return {
        action: "stopped",
        reason: "variant-lookup-truncated",
        details:
          `${stock.osProductId}: a változat-keresés kimerítette a limitet ` +
          `(${found.rows.length} sor) a ${link.medusaProductId} terméken, ` +
          `tehát lehet több változat is. Csonkolt halmazon nem döntünk: a ` +
          `"pontosan egy egyezés" ellenőrzés itt hamis nemleges választ adna. ` +
          `Nem írtunk semmit.`,
      };

    /**
     * ÉLŐ ÉS ELTEMETETT KÜLÖN, mert a keresés MOST MÁR mindkettőt hozza.
     *
     * A szétválasztás nem kényelem: a cikkszám indexe RÉSZLEGES, tehát
     * ugyanaz a cikkszám egyszerre ülhet egy élő és egy eltemetett változaton.
     * Egy halmazban számolva ez „több egyezés" lenne, holott a helyzet
     * hétköznapi és egyértelmű: az élő számít, az eltemetett történelem.
     */
    const variants = found.rows.filter((row) => !row.deleted_at);
    const buried = found.rows.filter((row) => row.deleted_at);
    const matching = variants.filter((row) => row.sku === stock.sku);
    const buriedMatching = buried.filter((row) => row.sku === stock.sku);

    if (matching.length === 0 && buriedMatching.length > 0)
      return {
        action: "stopped",
        reason: "variant-identity-chain-broken",
        details:
          `${stock.osProductId}: a ${stock.sku} cikkszám a Medusa terméken ` +
          `(${link.medusaProductId}) egy PUHÁN TÖRÖLT változaton ül ` +
          `(${buriedMatching.map((row) => row.id).join(", ")}), és élő ` +
          `változat nem viseli. Ez megszakadt azonossági lánc: nem hozunk ` +
          `létre újat, nem állítunk vissza, és nem is hagyjuk ki csendben. ` +
          `Készletet NEM írtunk. A Medusa cikkszám-indexe RÉSZLEGES, tehát az ` +
          `újra kiosztást MEGENGEDNÉ - hogy nem tesszük, az üzleti döntés, ` +
          `nem technikai korlát.`,
      };

    if (matching.length === 0)
      return {
        action: "stopped",
        reason: "variant-not-found",
        details:
          `${stock.osProductId}: a Medusa terméken (${link.medusaProductId}) ` +
          `nincs ${stock.sku} cikkszámú változat, sem élő, sem eltemetett. ` +
          `${describeSkus(variants)} A keresés a törölteket IS kérte ` +
          `(with_deleted), tehát ez a mondat a TELJES halmazra szól, nem csak ` +
          `az élőkre.`,
      };
    if (matching.length > 1)
      return {
        action: "stopped",
        reason: "ambiguous-variant",
        details:
          `${stock.osProductId}: a Medusa terméken (${link.medusaProductId}) ` +
          `${matching.length} változat viseli a ${stock.sku} cikkszámot: ` +
          `${matching.map((row) => row.id).join(", ")}.`,
      };

    const variant = matching[0]!;

    /**
     * A `manage_inventory === false` NEM hiba, de nem is folytatható: ilyen
     * változathoz a Medusa nem hoz létre inventory itemet, tehát nincs mire
     * készletet írni. Megnevezzük, hogy ne „nincs inventory item" alakban
     * jelenjen meg - a teendő ugyanis MÁS: a változaton kell átállítani.
     */
    if (variant.manage_inventory === false)
      return {
        action: "stopped",
        reason: "inventory-not-managed",
        details:
          `${stock.osProductId}: a ${variant.id} változat nem készletkezelt ` +
          `(manage_inventory=false), ezért nincs hozzá inventory item. ` +
          `Nem írtunk semmit.`,
      };

    if (variant.inventory_items === undefined)
      return {
        action: "stopped",
        reason: "inventory-chain-missing",
        details:
          `${stock.osProductId}: a válasz nem tartalmazta a változat ` +
          `készlet-láncát (inventory_items). Ez NEM azt jelenti, hogy nincs ` +
          `kapcsolat, hanem hogy másképp kell kérdezni. Nem írtunk semmit.`,
      };

    /**
     * AZ ÜRES LISTA ÉS A HIÁNYZÓ KITERJESZTÉS KÉT KÜLÖN VÁLASZ, EGY SZINTTEL
     * LEJJEBB IS.
     *
     * Az `inventory_items` mező meglétét fent már megnéztük. De egy NEM ÜRES
     * lista, amiben egyetlen bejegyzés sem hozza az `inventory` objektumot,
     * ugyanaz az eset egy szinttel lejjebb: a kapcsolat LÉTEZIK (különben nem
     * lenne bejegyzés), csak a kiterjesztés nem jött meg. Ha ezt „nincs
     * inventory item" néven jelentenénk, egy MEGLÉVŐ láncról állítanánk, hogy
     * nincs - és a teendő is más lenne: ott a változaton kellene javítani,
     * itt a lekérdezésen.
     */
    const chain = variant.inventory_items.filter((entry) => entry.inventory);
    if (variant.inventory_items.length > 0 && chain.length === 0)
      return {
        action: "stopped",
        reason: "inventory-chain-missing",
        details:
          `${stock.osProductId}: a ${variant.id} változathoz ` +
          `${variant.inventory_items.length} kapcsolat tartozik, de a válasz ` +
          `EGYIKHEZ SEM hozta az inventory objektumot. A kapcsolat tehát ` +
          `létezik, csak nem kérdeztünk jól. Nem írtunk semmit.`,
      };

    if (chain.length === 0)
      return {
        action: "stopped",
        reason: "no-inventory-item",
        details:
          `${stock.osProductId}: a ${variant.id} változathoz nem tartozik ` +
          `inventory item. Nem írtunk semmit.`,
      };
    if (chain.length > 1)
      return {
        action: "stopped",
        reason: "ambiguous-inventory-item",
        details:
          `${stock.osProductId}: a ${variant.id} változathoz ${chain.length} ` +
          `inventory item tartozik (${chain
            .map((entry) => entry.inventory?.id ?? "(azonosító nélkül)")
            .join(
              ", ",
            )}). Ez azonossági kérdés, nem a vetítés dolga eldönteni.`,
      };

    /**
     * A SZINTEK ABBÓL A BEJEGYZÉSBŐL JÖNNEK, AMELYIK AZ AZONOSÍTÓT IS ADTA.
     *
     * Az első változatom az azonosítót egy SZŰRT listából vette, a szinteket
     * viszont a nyers lista NULLADIK eleméből - két különböző bejegyzés, ha az
     * első nem hozott azonosítót. Egy ilyen eltérésnél a szinteket a rossz
     * itemről olvastuk volna, és a készlet a rossz helyre ment volna. Most a
     * kettő ugyanaz az objektum, tehát az eltérés nem lehetséges.
     */
    const inventory = chain[0]!.inventory!;
    const inventoryItemId = inventory.id;
    const levels = inventory.location_levels;
    if (levels === undefined)
      return {
        action: "stopped",
        reason: "inventory-chain-missing",
        details:
          `${stock.osProductId}: a válasz nem tartalmazta a készletszinteket ` +
          `(location_levels) a ${inventoryItemId} itemhez. Nem írtunk semmit.`,
      };

    let decision;
    try {
      decision = decideInventoryProjection(stock, stock.allowBackorder);
    } catch (error) {
      if (error instanceof MedusaInventoryQuantityError)
        return {
          action: "stopped",
          reason: "quantity-not-representable",
          details: `${stock.osProductId}: ${error.message}`,
        };
      throw error;
    }

    const existing = levels.find((row) => row.location_id === location.id);

    /**
     * A RENDELHETŐSÉG MEGY ELŐRE, ÉS EZ NEM SORREND-ÍZLÉS.
     *
     * Két írás kell, tehát van félállapot. A háromból a legkárosabb az, amikor
     * a MENNYISÉG beállt, de a rendelhetőség nem: akkor egy nulla készletű
     * termék nem vehető meg, holott a tulajdonos döntése szerint éppen
     * rendelhetőnek kellene lennie - és ez CSENDES hiba, mert a bolt működik,
     * csak nem enged vásárolni.
     *
     * Fordított sorrendben a maradó félállapot az, hogy a rendelhetőség helyes,
     * a mennyiség pedig a RÉGI marad. Az látszik, javítható, és nem tilt le
     * semmit.
     */
    const backorderNeeded = variant.allow_backorder !== decision.allowBackorder;
    if (backorderNeeded)
      try {
        await this.medusa.updateVariantBackorder(
          link.medusaProductId,
          variant.id,
          decision.allowBackorder,
        );
      } catch (error) {
        return {
          action: "stopped",
          reason: "medusa-write-failed",
          details:
            `${stock.osProductId}: a rendelhetőség beállítása elhasalt a ` +
            `${variant.id} változaton (${describeError(error)}). Készletet NEM ` +
            `írtunk, tehát a Medusa oldali állapot változatlan.`,
        };
      }

    const quantityNeeded =
      !existing || existing.stocked_quantity !== decision.medusaQuantity;

    if (quantityNeeded)
      try {
        if (existing)
          await this.medusa.updateInventoryLevel(
            inventoryItemId,
            location.id,
            decision.medusaQuantity,
          );
        else
          await this.medusa.createInventoryLevel(
            inventoryItemId,
            location.id,
            decision.medusaQuantity,
          );
      } catch (error) {
        return {
          action: "stopped",
          reason: "medusa-write-failed",
          details:
            `${stock.osProductId}: a készlet ${existing ? "beállítása" : "létrehozása"} ` +
            `elhasalt (${describeError(error)}). ` +
            (backorderNeeded
              ? `A rendelhetőség viszont MÁR BEÁLLT a ${variant.id} változaton: ` +
                `félállapot. A mennyiség a régi maradt, a rendelhetőség helyes. ` +
                `Az újrafuttatás ugyanoda konvergál.`
              : `A rendelhetőség nem igényelt változtatást, tehát a Medusa ` +
                `oldali állapot változatlan.`),
        };
      }

    const report: InventoryProjectionReport = {
      sku: stock.sku,
      onHand: stock.onHand.toString(),
      reserved: (stock.reserved ?? new Prisma.Decimal(0)).toString(),
      availableToSell: decision.availableToSell.toString(),
      medusaQuantity: decision.medusaQuantity,
      medusaReserved: existing?.reserved_quantity ?? null,
      locationId: location.id,
      locationName: location.name,
      inventoryItemId,
      variantId: variant.id,
      clamped: decision.clamped,
      fractionDropped: decision.fractionDropped,
      backorder: decision.allowBackorder,
      levelResult: quantityNeeded
        ? existing
          ? "updated"
          : "created"
        : "unchanged",
      backorderResult: backorderNeeded ? "set" : "unchanged",
    };

    if (!quantityNeeded && !backorderNeeded)
      return { action: "no-change", report };
    return { action: existing ? "updated" : "created", report };
  }
}

/** Mit LÁTTUNK a terméken, ha a keresett cikkszám nem volt köztük. */
function describeSkus(variants: MedusaVariantRow[]): string {
  if (!variants.length) return "A terméknek egyetlen változata sincs.";
  return `A meglévő cikkszámok: ${variants
    .map((row) => row.sku ?? "(nincs)")
    .join(", ")}.`;
}

/**
 * A megállás-szöveg hibaleírása. EGY helyre mutat, szándékosan.
 *
 * Eddig az `error.message` ment ki, ami HTTP-hibánál a Medusa válaszának első
 * 500 karakterét is viszi. Ez a jelentésbe és a parancssori kimenetre kerül,
 * és onnantól nem tudjuk, ki olvassa - a brief pedig kimondja, hogy a titok
 * plaintext értéke hibakimenetben sem jelenhet meg. Mostantól a STÁTUSZ megy
 * ki, a törzs nem.
 */
const describeError = describeMedusaFailure;

/** Csak a teszteknek, hogy a szint alakja egy helyen legyen leírva. */
export type { MedusaInventoryLevelRow };
