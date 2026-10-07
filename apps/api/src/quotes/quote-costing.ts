import { Prisma } from "@acropora/database";
import type {
  QuoteCostingDto,
  QuoteCostingLineDto,
  QuoteItemSourceValue,
  QuoteBomKindValue,
} from "@acropora/types";

import type { PriceSourceDecision } from "../integrations/medusa/medusa-price-source.js";
import { costWarnings } from "./quote-cost-snapshot.js";

/**
 * THE COSTING OF ONE QUOTE VERSION (#1582 P1, `quotes.costs.view` only).
 *
 * The suggested price, as acrobot decided it (27773), with NO markup rule
 * invented here:
 *
 *   PRODUCT     the variant's selling price today, netted with the VARIANT's
 *               VAT rate                                    -> LIST_PRICE
 *   BOM         the selling price of the PRODUCT rows times their quantity,
 *               plus the COST of the CUSTOM and SERVICE rows, per unit of the
 *               customer line                               -> BOM_SUM
 *   STANDALONE  none
 *
 * The source is named in the answer, so a markup rule can stand beside it
 * later without changing what the number means.
 *
 * The margin: line net minus the BOM cost, and its share of the line net. A
 * BOM row's quantity is for the WHOLE customer line (not per unit).
 *
 * WHY AN INCOMPLETE COST GIVES NO MARGIN: a missing row cost makes the cost a
 * LOWER bound, so the margin would be an UPPER bound and look better than it
 * is. That error is silent, the missing number is not: the margin stays null
 * and a warning names the row.
 */

export interface CostingListPrice {
  /** net per unit in HUF, or null with the reason */
  unitNet: Prisma.Decimal | null;
  reason: string | null;
  /** a running sale price was used */
  sale: boolean;
}

export interface CostingInput {
  versionId: string;
  currency: string;
  items: Array<{
    id: string;
    name: string;
    source: QuoteItemSourceValue;
    variantId: string | null;
    quantity: Prisma.Decimal;
    unitNetPrice: Prisma.Decimal;
    isOptional: boolean;
  }>;
  bomItems: Array<{
    quoteItemId: string;
    kind: QuoteBomKindValue;
    variantId: string | null;
    customName: string | null;
    quantity: Prisma.Decimal;
    unitCost: Prisma.Decimal | null;
    costCurrency: string | null;
    costSource: string | null;
    sourcePurchaseInvoiceLineId: string | null;
    /** the variant's display name, for the warnings */
    label: string;
  }>;
  /** by variant id */
  listPrices: Map<string, CostingListPrice>;
}

const HUF = "HUF";
const ZERO = new Prisma.Decimal(0);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(4).toFixed(4);
const percent = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

function margin(net: Prisma.Decimal, cost: Prisma.Decimal | null) {
  if (cost === null) return { amount: null, percent: null };
  const amount = net.minus(cost);
  return {
    amount: money(amount),
    percent: net.gt(0) ? percent(amount.dividedBy(net).times(100)) : null,
  };
}

export function computeCosting(input: CostingInput): QuoteCostingDto {
  const huf = input.currency.toUpperCase() === HUF;
  const warnings: string[] = huf
    ? []
    : [
        `Az ajánlat pénzneme ${input.currency}, a költségek forintban vannak: fedezet és javasolt ár nem számolható.`,
      ];

  const lines: QuoteCostingLineDto[] = input.items.map((item) => {
    const lineWarnings: string[] = [];
    const lineNet = item.quantity.times(item.unitNetPrice);
    const bom = input.bomItems.filter((b) => b.quoteItemId === item.id);

    // the cost of the whole line
    let cost: Prisma.Decimal | null = null;
    let costComplete = bom.length > 0;
    for (const b of bom) {
      lineWarnings.push(...costWarnings(b.label, b));
      if (b.unitCost === null) {
        costComplete = false;
        continue;
      }
      cost = (cost ?? ZERO).plus(b.quantity.times(b.unitCost));
    }
    // the item's own row (P1): exactly one PRODUCT row of the item's variant
    // and quantity; otherwise the cost may be the old part's or amount
    if (item.source === "PRODUCT" && bom.length) {
      const own = bom.filter(
        (b) => b.kind === "PRODUCT" && b.variantId === item.variantId,
      );
      if (own.length !== 1 || !own[0]!.quantity.eq(item.quantity))
        lineWarnings.push(
          `${item.name}: a termék saját anyaglista-sora nem egyezik a tétellel (változat vagy mennyiség), a költséget ellenőrizd.`,
        );
    }
    if (!bom.length)
      lineWarnings.push(
        item.source === "STANDALONE"
          ? `${item.name}: önálló tétel, nincs költsége.`
          : `${item.name}: nincs anyaglista, nincs költség.`,
      );

    // the suggested unit price
    let suggested: Prisma.Decimal | null = null;
    let suggestedComplete = false;
    let suggestedSource: QuoteCostingLineDto["suggestedPriceSource"] = null;
    if (huf && item.source === "PRODUCT" && item.variantId) {
      suggestedSource = "LIST_PRICE";
      const price = input.listPrices.get(item.variantId);
      if (price?.unitNet) {
        suggested = price.unitNet;
        suggestedComplete = true;
        if (price.sale)
          lineWarnings.push(
            `${item.name}: a javasolt ár a most futó akciós árból jön.`,
          );
      } else
        lineWarnings.push(
          `${item.name}: nincs javasolt ár (${price?.reason ?? "ismeretlen termék"}).`,
        );
    } else if (huf && item.source === "BOM") {
      suggestedSource = "BOM_SUM";
      suggestedComplete = bom.length > 0;
      let sum: Prisma.Decimal | null = null;
      for (const b of bom) {
        let rowUnit: Prisma.Decimal | null;
        if (b.kind === "PRODUCT") {
          const price = b.variantId ? input.listPrices.get(b.variantId) : null;
          rowUnit = price?.unitNet ?? null;
          if (!rowUnit)
            lineWarnings.push(
              `${b.label}: nincs eladási ár a javasolt árhoz (${price?.reason ?? "ismeretlen termék"}).`,
            );
        } else rowUnit = b.unitCost;
        if (rowUnit === null) {
          suggestedComplete = false;
          continue;
        }
        sum = (sum ?? ZERO).plus(b.quantity.times(rowUnit));
      }
      suggested = sum === null ? null : sum.dividedBy(item.quantity);
      if (sum !== null && !suggestedComplete)
        lineWarnings.push(
          `${item.name}: a javasolt ár hiányos, legalább egy anyaglista-sorból hiányzik az adat.`,
        );
    }

    const shownCost = huf && costComplete ? cost : null;
    if (huf && cost !== null && !costComplete)
      lineWarnings.push(
        `${item.name}: a költség hiányos, ezért a fedezet nem számolható.`,
      );
    const m = margin(lineNet, shownCost);
    return {
      itemId: item.id,
      name: item.name,
      isOptional: item.isOptional,
      quantity: item.quantity.toString(),
      unitNetPrice: item.unitNetPrice.toString(),
      lineNet: money(lineNet),
      bomCost: cost === null ? null : money(cost),
      bomCostComplete: costComplete,
      suggestedUnitPrice: suggested === null ? null : money(suggested),
      suggestedPriceSource: suggestedSource,
      suggestedPriceComplete: suggestedComplete,
      marginAmount: m.amount,
      marginPercent: m.percent,
      warnings: lineWarnings,
    };
  });

  // totals: the offered (non-optional) lines only
  const offered = input.items.filter((i) => !i.isOptional);
  const offeredLines = lines.filter((l) => !l.isOptional);
  const net = offered.reduce(
    (s, i) => s.plus(i.quantity.times(i.unitNetPrice)),
    ZERO,
  );
  const withCost = offeredLines.filter((l) => l.bomCost !== null);
  const cost = withCost.length
    ? withCost.reduce((s, l) => s.plus(l.bomCost!), ZERO)
    : null;
  const costComplete =
    offeredLines.length > 0 && offeredLines.every((l) => l.bomCostComplete);
  const m = margin(net, huf && costComplete ? cost : null);
  if (huf && offeredLines.length && !costComplete)
    warnings.push(
      "Legalább egy tételnek hiányzik a költsége, ezért az összesített fedezet nem számolható.",
    );

  return {
    versionId: input.versionId,
    currency: input.currency,
    lines,
    totals: {
      net: money(net),
      cost: cost === null ? null : money(cost),
      costComplete,
      marginAmount: m.amount,
      marginPercent: m.percent,
    },
    warnings,
  };
}

/**
 * A variant's selling price today as a HUF net (acrobot 27773): the gross from
 * `resolvePriceSource` (the catalog owner decides mirror or own), netted with
 * the VARIANT's VAT rate. Every gap is a named reason, never a zero.
 */
export function listPriceFromDecision(
  decision: PriceSourceDecision,
  vatRate: Prisma.Decimal | null,
): CostingListPrice {
  if (!decision.ok)
    return { unitNet: null, reason: decision.reason, sale: false };
  const gross = decision.price.sellingGrossPrice;
  if (gross === null)
    return { unitNet: null, reason: "price-missing", sale: false };
  const currency = (decision.price.sellingPriceCurrency ?? HUF).toUpperCase();
  if (currency !== HUF)
    return { unitNet: null, reason: `currency-${currency}`, sale: false };
  if (vatRate === null)
    return { unitNet: null, reason: "vat-rate-missing", sale: false };
  return {
    unitNet: gross.dividedBy(
      new Prisma.Decimal(1).plus(vatRate.dividedBy(100)),
    ),
    reason: null,
    sale: decision.source === "mirror-sale",
  };
}
