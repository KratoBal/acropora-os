import { Prisma } from "@acropora/database";
import type { BillingLineStockOutcome } from "@acropora/types";

import { parseUnasPackageComponents } from "../common/unas-package-product.util.js";
import { isUnasMasteredVariant } from "../products/catalog-authority.js";

/**
 * A KIÁLLÍTOTT SZÁMLA KÉSZLETHATÁSA (Balázs kérése, 2026-09-30 18:09 UTC,
 * acrobot döntései 25245 és 25249): a számlán kiszámlázott készletezett termék
 * készlete csökken az OS-ben, és a központi írón (`postInventoryMovement`) át
 * a UNAS-ban is. A Medusa ugyanazt kapja, mint a bevételezés: ma semmit
 * magától (a vetítés parancssori).
 *
 * TISZTA TERV: sorokra bontja, mi mozog és mi nem, és MIÉRT NEM. Az ok
 * soronként tárolódik (`InvoiceLine.stockOutcome`), és a részleteken látszik,
 * mert utólag a termék megváltozhat (új változatot kaphat), és akkor a mai
 * döntés már nem számolható vissza.
 */

/** Csak a számla mozgat: a díjbekérő és az előleg nem ad ki árut, a
 *  szállítólevél után pedig a számla jönne, és kétszer vonnánk le. */
export const STOCK_MOVING_TYPES: ReadonlySet<string> = new Set(["INVOICE"]);

/** Ezekből a forrásokból a készlet MÁR mozgott (UNAS rendelés-import, POS
 *  eladás); mérve 2026-09-30: a munkalap és a projekt nem von le. */
export const SOURCES_THAT_ALREADY_MOVED: ReadonlySet<string> = new Set([
  "SALES_ORDER",
  "POS_TRANSACTION",
]);

export interface StockVariant {
  id: string;
  sku: string;
  unit: string;
}

export interface StockProduct {
  id: string;
  type: string;
  catalogAuthority: "UNAS" | "ACROPORA" | null;
  variants: StockVariant[];
  isPackageProduct: boolean;
  packageComponents: Prisma.JsonValue | null;
}

export interface StockComponentVariant extends StockVariant {
  catalogAuthority: "UNAS" | "ACROPORA" | null;
  isPackageProduct: boolean;
}

export interface StockPlanLine {
  id: string;
  kind: string;
  productId: string | null;
  quantity: Prisma.Decimal;
}

export interface PlannedMovementLine {
  variantId: string;
  sku: string;
  unit: string;
  quantityDelta: Prisma.Decimal;
  syncToUnas: boolean;
}

export interface StockPlan {
  /** Soronként az eredmény; a mozgó soroké `MOVED`. */
  outcomes: Map<string, BillingLineStockOutcome>;
  /** Változatonként összevonva, negatív előjellel. */
  movement: PlannedMovementLine[];
}

export function planInvoiceStock(input: {
  documentType: string;
  sourceType: string | null;
  lines: readonly StockPlanLine[];
  products: ReadonlyMap<string, StockProduct>;
  componentsBySku: ReadonlyMap<string, StockComponentVariant>;
}): StockPlan {
  const outcomes = new Map<string, BillingLineStockOutcome>();
  const byVariant = new Map<string, PlannedMovementLine>();
  const add = (variant: StockVariant, delta: Prisma.Decimal, sync: boolean) => {
    const existing = byVariant.get(variant.id);
    if (existing) existing.quantityDelta = existing.quantityDelta.plus(delta);
    else
      byVariant.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        unit: variant.unit,
        quantityDelta: delta,
        syncToUnas: sync,
      });
  };

  for (const line of input.lines) {
    if (line.kind !== "ITEM" || !line.productId) {
      outcomes.set(line.id, "NOT_STOCKED");
      continue;
    }
    if (!STOCK_MOVING_TYPES.has(input.documentType)) {
      outcomes.set(line.id, "NOT_A_STOCK_DOCUMENT");
      continue;
    }
    if (input.sourceType && SOURCES_THAT_ALREADY_MOVED.has(input.sourceType)) {
      outcomes.set(line.id, "MOVED_BY_SOURCE");
      continue;
    }
    const product = input.products.get(line.productId);
    if (!product || product.type === "SERVICE") {
      outcomes.set(line.id, "NOT_STOCKED");
      continue;
    }
    if (product.variants.length === 0) {
      outcomes.set(line.id, "NO_VARIANT");
      continue;
    }
    if (product.variants.length > 1) {
      // acrobot (c): a sor csak terméket hordoz; ahol több változat van, nem
      // találgatunk, hanem látható okkal kihagyjuk.
      outcomes.set(line.id, "VARIANT_NOT_CHOSEN");
      continue;
    }
    const variant = product.variants[0]!;
    const sold = line.quantity.negated();

    if (product.isPackageProduct) {
      // A POS-szal azonosan: a csomag az összetevőit mozgatja, és ha
      // bármelyik nem oldható fel biztonságosan, egyiket sem.
      const components = parseUnasPackageComponents(product.packageComponents);
      const resolved = components.flatMap((component) => {
        const found = input.componentsBySku.get(component.sku);
        if (
          !found ||
          found.isPackageProduct ||
          !isUnasMasteredVariant({
            product: { catalogAuthority: found.catalogAuthority },
          })
        )
          return [];
        return [{ found, qty: component.qty }];
      });
      if (resolved.length === 0 || resolved.length !== components.length) {
        outcomes.set(line.id, "PACKAGE_UNRESOLVED");
        continue;
      }
      for (const { found, qty } of resolved) add(found, sold.times(qty), true);
      outcomes.set(line.id, "MOVED");
      continue;
    }

    add(
      variant,
      sold,
      isUnasMasteredVariant({
        product: { catalogAuthority: product.catalogAuthority },
      }),
    );
    outcomes.set(line.id, "MOVED");
  }

  return {
    outcomes,
    movement: [...byVariant.values()].filter(
      (line) => !line.quantityDelta.isZero(),
    ),
  };
}

/** Egy számla egy mozgás: az újrapróbált kiállítás nem von le kétszer. */
export const invoiceStockIdempotencyKey = (invoiceId: string) =>
  `BILLING_INVOICE:${invoiceId}`;
