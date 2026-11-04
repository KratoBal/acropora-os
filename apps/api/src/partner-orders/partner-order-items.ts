import { Prisma } from "@acropora/database";
import { computeCertificateLineAmounts } from "../completion-certificates/completion-certificate-amounts.js";
import type {
  PartnerOrderLineDto,
  PartnerOrderTotalsDto,
  QuoteRichText,
} from "@acropora/types";

/** One line of a quote version as stored (the fields the order needs). */
export interface QuoteItemSource {
  id: string;
  /** Position of the line's block, then of the line inside it. */
  blockPosition: number;
  position: number;
  name: string;
  description: QuoteRichText | null;
  quantity: Prisma.Decimal;
  unit: string;
  unitNetPrice: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  isOptional: boolean;
}

/**
 * The lines of an order: every non-optional line of the accepted version, plus the optional lines the
 * customer chose (`QuoteAcceptance.selectedOptionalItemIds`). The same rule as the project handoff
 * (`quote-handoff.service.ts`) and the proforma (`quote-proforma.ts`), kept in one place for the order
 * and for the completion certificate and invoicing slices that read the same lines.
 */
export function selectOrderItems(
  items: readonly QuoteItemSource[],
  selectedOptionalIds: readonly string[],
): PartnerOrderLineDto[] {
  const selected = new Set(selectedOptionalIds);
  return items
    .filter((item) => !item.isOptional || selected.has(item.id))
    .slice()
    .sort(
      (a, b) => a.blockPosition - b.blockPosition || a.position - b.position,
    )
    .map((item, index) => ({
      quoteItemId: item.id,
      position: index + 1,
      name: item.name,
      description: item.description,
      quantity: item.quantity.toString(),
      unit: item.unit,
      unitNetPrice: item.unitNetPrice.toString(),
      vatRatePercent: item.vatRatePercent.toString(),
      netAmount: item.quantity.times(item.unitNetPrice).toString(),
      wasOptional: item.isOptional,
    }));
}

const ZERO = new Prisma.Decimal(0);

/** HUF has no minor unit on invoices; everything else rounds to two decimals. */
function currencyDecimals(currency: string): number {
  return currency === "HUF" ? 0 : 2;
}

/**
 * Net, VAT and gross, summed per VAT rate, ROUNDED PER LINE and then added: the invoice is the measure
 * (ADR-014, and Számlázz.hu rounds the same way), so the page, the completion certificates and the invoice
 * give the same forint total. A line's net comes from the raw product, its VAT from that net (both to four
 * decimals, as the certificate does), and net and VAT are rounded to the currency's decimals before the lines
 * are added up. Adding the exact
 * values and rounding the sum can differ by 1 Ft over several lines.
 */
export function orderTotals(
  lines: readonly Pick<
    PartnerOrderLineDto,
    "quantity" | "unitNetPrice" | "vatRatePercent"
  >[],
  currency: string,
): PartnerOrderTotalsDto {
  const decimals = currencyDecimals(currency);
  const round = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
  const rates = new Map<
    string,
    {
      rate: Prisma.Decimal;
      net: Prisma.Decimal;
      vat: Prisma.Decimal;
      gross: Prisma.Decimal;
    }
  >();
  for (const line of lines) {
    const exact = computeCertificateLineAmounts({
      quantity: line.quantity,
      unitPrice: line.unitNetPrice,
      vatRatePercent: line.vatRatePercent,
    });
    const rate = new Prisma.Decimal(line.vatRatePercent);
    const key = rate.toString();
    const seen = rates.get(key);
    // The line's gross is its rounded net plus its rounded VAT, so the three printed numbers of a line
    // always add up (rounding the exact gross separately can leave a line 1 Ft short of net + VAT).
    const net = round(exact.netAmount);
    const vat = round(exact.vatAmount);
    rates.set(key, {
      rate,
      net: (seen?.net ?? ZERO).plus(net),
      vat: (seen?.vat ?? ZERO).plus(vat),
      gross: (seen?.gross ?? ZERO).plus(net).plus(vat),
    });
  }
  const byRate = [...rates.values()]
    .sort((a, b) => b.rate.comparedTo(a.rate))
    .map(({ rate, net, vat, gross }) => ({
      vatRatePercent: rate.toString(),
      net: net.toFixed(decimals),
      vat: vat.toFixed(decimals),
      gross: gross.toFixed(decimals),
    }));
  const sum = (pick: "net" | "vat" | "gross") =>
    byRate.reduce((total, r) => total.plus(r[pick]), ZERO).toFixed(decimals);
  return { net: sum("net"), vat: sum("vat"), gross: sum("gross"), byRate };
}
