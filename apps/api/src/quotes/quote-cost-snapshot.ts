import { Prisma } from "@acropora/database";

/**
 * THE PURCHASE COST SNAPSHOT OF A BOM LINE (#1582 C6, P1).
 *
 * The cost is taken ONCE, when the line gets its product, and stored on the
 * line: a later receipt does not move an offered price. The source, in order:
 *
 *   1. the LAST purchase line of the variant, on a POSTED invoice, by the
 *      invoice DATE (not by the order it was recorded in: a late-recorded old
 *      invoice must not win), net after the line discount, and for a foreign
 *      currency times the invoice's stored exchange rate;
 *   2. the variant's `ProductExtension.lastPurchaseNetPrice` as a fallback, with no source line
 *      (`costSource = LAST_PURCHASE`, `sourcePurchaseInvoiceLineId = null`), so
 *      the stored data tells the two apart (brief "Pontosítások" 1).
 *
 * A foreign amount is NEVER stored as HUF: a foreign line without a rate goes
 * to the fallback, and a foreign fallback without a rate leaves `unitCost`
 * empty with the original amount kept (brief "Pontosítások" 2).
 */

export interface CostSnapshot {
  unitCost: Prisma.Decimal | null;
  costCurrency: string | null;
  costOriginal: Prisma.Decimal | null;
  exchangeRate: Prisma.Decimal | null;
  /** `MANUAL` only from the editor (a hand-entered cost), never from a snapshot */
  costSource: "LAST_PURCHASE" | "MANUAL" | null;
  costSourceDate: Date | null;
  sourcePurchaseInvoiceLineId: string | null;
  supplierId: string | null;
}

export const NO_COST: CostSnapshot = {
  unitCost: null,
  costCurrency: null,
  costOriginal: null,
  exchangeRate: null,
  costSource: null,
  costSourceDate: null,
  sourcePurchaseInvoiceLineId: null,
  supplierId: null,
};

export interface PurchaseLineForCost {
  id: string;
  unitNet: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  purchaseInvoice: {
    currency: string;
    exchangeRate: Prisma.Decimal | null;
    invoiceDate: Date;
    supplierId: string;
  };
}

export interface FallbackPriceForCost {
  lastPurchaseNetPrice: Prisma.Decimal | null;
  defaultPurchaseCurrency: string | null;
}

/** The unit net after the line discount, in the line's own currency. */
export function discountedUnitNet(
  unitNet: Prisma.Decimal,
  discountPercent: Prisma.Decimal | null,
): Prisma.Decimal {
  if (!discountPercent) return unitNet;
  return unitNet.times(
    new Prisma.Decimal(1).minus(discountPercent.dividedBy(100)),
  );
}

const HUF = "HUF";
const round4 = (d: Prisma.Decimal) => d.toDecimalPlaces(4);

/** The pure decision: which source, which numbers. */
export function decideCostSnapshot(
  line: PurchaseLineForCost | null,
  fallback: FallbackPriceForCost | null,
): CostSnapshot {
  if (line) {
    const currency = line.purchaseInvoice.currency.toUpperCase();
    const original = discountedUnitNet(line.unitNet, line.discountPercent);
    const rate = line.purchaseInvoice.exchangeRate;
    if (currency === HUF || rate)
      return {
        unitCost: round4(currency === HUF ? original : original.times(rate!)),
        costCurrency: currency,
        costOriginal: round4(original),
        exchangeRate: currency === HUF ? null : rate,
        costSource: "LAST_PURCHASE",
        costSourceDate: line.purchaseInvoice.invoiceDate,
        sourcePurchaseInvoiceLineId: line.id,
        supplierId: line.purchaseInvoice.supplierId,
      };
    // a foreign line without a stored rate: fall through to the fallback
  }
  if (fallback?.lastPurchaseNetPrice) {
    const currency = (fallback.defaultPurchaseCurrency ?? HUF).toUpperCase();
    return {
      ...NO_COST,
      unitCost: currency === HUF ? round4(fallback.lastPurchaseNetPrice) : null,
      costCurrency: currency,
      costOriginal: round4(fallback.lastPurchaseNetPrice),
      costSource: "LAST_PURCHASE",
    };
  }
  return NO_COST;
}

export interface CostSnapshotDatabase {
  purchaseInvoiceLine: {
    findFirst(args: unknown): Promise<PurchaseLineForCost | null>;
  };
  productVariant: {
    findUnique(args: unknown): Promise<{
      extension: FallbackPriceForCost | null;
    } | null>;
  };
}

/** Reads the last POSTED purchase line by invoice date, and the fallback. */
export async function snapshotCost(
  db: CostSnapshotDatabase,
  variantId: string,
): Promise<CostSnapshot> {
  const line = await db.purchaseInvoiceLine.findFirst({
    where: { variantId },
    orderBy: [
      { purchaseInvoice: { invoiceDate: "desc" } },
      { purchaseInvoice: { createdAt: "desc" } },
      { id: "desc" },
    ],
    select: {
      id: true,
      unitNet: true,
      discountPercent: true,
      purchaseInvoice: {
        select: {
          currency: true,
          exchangeRate: true,
          invoiceDate: true,
          supplierId: true,
        },
      },
    },
  });
  // the fallback price lives on the VARIANT's extension
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    select: {
      extension: {
        select: { lastPurchaseNetPrice: true, defaultPurchaseCurrency: true },
      },
    },
  });
  return decideCostSnapshot(line, variant?.extension ?? null);
}

/**
 * The warnings of a stored snapshot, computed on READ (not stored; brief
 * "Pontosítások" 1). Hungarian, for the costing view.
 */
export function costWarnings(
  label: string,
  row: {
    kind: string;
    unitCost: Prisma.Decimal | null;
    costCurrency: string | null;
    costSource: string | null;
    sourcePurchaseInvoiceLineId: string | null;
  },
): string[] {
  if (row.unitCost === null) {
    if (
      row.costSource === "LAST_PURCHASE" &&
      row.costCurrency &&
      row.costCurrency !== HUF
    )
      return [
        `${label}: a tartalék beszerzési ár ${row.costCurrency} pénznemű, és nincs mellette árfolyam, ezért nincs költség.`,
      ];
    return [`${label}: nincs költség.`];
  }
  if (row.costSource === "LAST_PURCHASE" && !row.sourcePurchaseInvoiceLineId)
    return [
      `${label}: a költség a termék utolsó beszerzési árából jön (tartalék), nem bevételezett számlasorból.`,
    ];
  return [];
}
