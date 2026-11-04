import { Prisma } from "@acropora/database";
import {
  computeCertificateLineAmounts,
  wholeForintCertificateAmounts,
} from "../completion-certificates/completion-certificate-amounts.js";
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

const ZERO = new Prisma.Decimal(0);

/** HUF has no minor unit on invoices; everything else rounds to two decimals. */
function currencyDecimals(currency: string): number {
  return currency === "HUF" ? 0 : 2;
}

interface PricedLine {
  quantity: string | Prisma.Decimal;
  unitNetPrice: string | Prisma.Decimal;
  vatRatePercent: string | Prisma.Decimal;
}

/**
 * ONE LINE'S NET, VAT AND GROSS, AS THE COMPLETION CERTIFICATE AND THE INVOICE STATE THEM. In HUF this is the
 * certificate's own `wholeForintCertificateAmounts` (net rounded to whole forints, the VAT from that ROUNDED net,
 * the gross their sum), so the order page, the certificate and the invoice give the same forints. Other currencies
 * follow the same order of steps with two decimals: round the net, take the VAT of the rounded net, add.
 */
export function roundedLineAmounts(
  line: PricedLine,
  currency: string,
): { net: Prisma.Decimal; vat: Prisma.Decimal; gross: Prisma.Decimal } {
  const exact = computeCertificateLineAmounts({
    quantity: line.quantity,
    unitPrice: line.unitNetPrice,
    vatRatePercent: line.vatRatePercent,
  });
  if (currency === "HUF") {
    const whole = wholeForintCertificateAmounts(exact, line.vatRatePercent);
    return {
      net: whole.netAmount,
      vat: whole.vatAmount,
      gross: whole.grossAmount,
    };
  }
  const round = (value: Prisma.Decimal) =>
    value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const net = round(exact.netAmount);
  const vat = round(
    net.times(new Prisma.Decimal(line.vatRatePercent)).div(100),
  );
  return { net, vat, gross: net.plus(vat) };
}

/**
 * The lines of an order: every non-optional line of the accepted version, plus the optional lines the
 * customer chose (`QuoteAcceptance.selectedOptionalItemIds`). The same rule as the project handoff
 * (`quote-handoff.service.ts`) and the proforma (`quote-proforma.ts`), kept in one place for the order
 * and for the completion certificate and invoicing slices that read the same lines. Each line carries
 * its rounded amounts, so a page never has to recompute them.
 */
export function selectOrderItems(
  items: readonly QuoteItemSource[],
  selectedOptionalIds: readonly string[],
  currency: string,
): PartnerOrderLineDto[] {
  const selected = new Set(selectedOptionalIds);
  const decimals = currencyDecimals(currency);
  return items
    .filter((item) => !item.isOptional || selected.has(item.id))
    .slice()
    .sort(
      (a, b) => a.blockPosition - b.blockPosition || a.position - b.position,
    )
    .map((item, index) => {
      const rounded = roundedLineAmounts(item, currency);
      return {
        quoteItemId: item.id,
        position: index + 1,
        name: item.name,
        description: item.description,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitNetPrice: item.unitNetPrice.toString(),
        vatRatePercent: item.vatRatePercent.toString(),
        netAmount: item.quantity.times(item.unitNetPrice).toString(),
        rounded: {
          net: rounded.net.toFixed(decimals),
          vat: rounded.vat.toFixed(decimals),
          gross: rounded.gross.toFixed(decimals),
        },
        wasOptional: item.isOptional,
      };
    });
}

/**
 * Net, VAT and gross, summed per VAT rate from the lines' ROUNDED amounts: the invoice is the measure (ADR-014),
 * and the lines are rounded exactly as the certificate rounds them (`roundedLineAmounts`), so the page, the
 * certificates and the invoice give the same forint total. Adding the exact values and rounding the sum can
 * differ by 1 Ft over several lines.
 */
export function orderTotals(
  lines: readonly PricedLine[],
  currency: string,
): PartnerOrderTotalsDto {
  const decimals = currencyDecimals(currency);
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
    const amounts = roundedLineAmounts(line, currency);
    const rate = new Prisma.Decimal(line.vatRatePercent);
    const key = rate.toString();
    const seen = rates.get(key);
    rates.set(key, {
      rate,
      net: (seen?.net ?? ZERO).plus(amounts.net),
      vat: (seen?.vat ?? ZERO).plus(amounts.vat),
      gross: (seen?.gross ?? ZERO).plus(amounts.gross),
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
