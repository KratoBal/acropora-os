import { Injectable } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type {
  MedusaAdminClient,
  MedusaInventoryLevelRow,
  MedusaVariantRow,
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
  /** A Medusa terméken nincs ilyen cikkszámú változat. */
  | "variant-not-found"
  /** Több változat viseli ugyanazt a cikkszámot ugyanazon a terméken. */
  | "ambiguous-variant"
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
          `a(z) ${this.storefrontSalesChannelId} csatornához ${locations.length} ` +
          `készlethely tartozik: ${locations
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

    const location = await this.resolveLocation();
    if ("error" in location)
      return {
        action: "stopped",
        reason: "stock-location-not-resolved",
        details: `${stock.osProductId}: ${location.error}`,
      };

    const variants = await this.medusa.listProductVariants(
      link.medusaProductId,
    );
    const matching = variants.filter((row) => row.sku === stock.sku);

    if (matching.length === 0)
      return {
        action: "stopped",
        reason: "variant-not-found",
        details:
          `${stock.osProductId}: a Medusa terméken (${link.medusaProductId}) ` +
          `nincs ${stock.sku} cikkszámú változat. ${describeSkus(variants)}`,
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

    const inventoryIds = variant.inventory_items
      .map((entry) => entry.inventory?.id)
      .filter((value): value is string => Boolean(value));

    if (inventoryIds.length === 0)
      return {
        action: "stopped",
        reason: "no-inventory-item",
        details:
          `${stock.osProductId}: a ${variant.id} változathoz nem tartozik ` +
          `inventory item. Nem írtunk semmit.`,
      };
    if (inventoryIds.length > 1)
      return {
        action: "stopped",
        reason: "ambiguous-inventory-item",
        details:
          `${stock.osProductId}: a ${variant.id} változathoz ${inventoryIds.length} ` +
          `inventory item tartozik (${inventoryIds.join(", ")}). Ez azonossági ` +
          `kérdés, nem a vetítés dolga eldönteni.`,
      };

    const inventoryItemId = inventoryIds[0]!;
    const levels = variant.inventory_items[0]?.inventory?.location_levels;
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
      decision = decideInventoryProjection(stock);
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Csak a teszteknek, hogy a szint alakja egy helyen legyen leírva. */
export type { MedusaInventoryLevelRow };
