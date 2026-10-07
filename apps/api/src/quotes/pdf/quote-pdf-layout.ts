import { Prisma } from "@acropora/database";
import type { QuotePriceDisplay, QuoteRichText } from "@acropora/types";

/**
 * THE QUOTE PDF'S CONTENT, WITHOUT DRAWING (#1582 P2). Everything here is a
 * pure function of the version, so the renderer only places it, and the
 * numbers can be tested without a PDF.
 */

export interface QuotePdfItem {
  name: string;
  description: QuoteRichText | null;
  quantity: Prisma.Decimal;
  unit: string;
  unitNetPrice: Prisma.Decimal;
  vatRatePercent: Prisma.Decimal;
  isOptional: boolean;
}

export interface QuotePdfBlock {
  kind: string;
  title: string | null;
  content: QuoteRichText | null;
  keepWithNext: boolean;
  startOnNewPage: boolean;
  items: QuotePdfItem[];
}

export interface QuotePdfInput {
  quoteNumber: string;
  title: string;
  versionNumber: number;
  /** YYYY-MM-DD */
  validUntil: string;
  currency: string;
  priceDisplay: QuotePriceDisplay;
  customer: { name: string; lines: string[] } | null;
  blocks: QuotePdfBlock[];
  milestones: Array<{ label: string; percent: Prisma.Decimal }>;
  /** the publish request time: the PDF's CreationDate (determinism) */
  creationDate: Date;
}

const ZERO = new Prisma.Decimal(0);

export function lineNet(item: QuotePdfItem): Prisma.Decimal {
  return item.quantity.times(item.unitNetPrice);
}
export function lineGross(item: QuotePdfItem): Prisma.Decimal {
  return lineNet(item).times(
    new Prisma.Decimal(1).plus(item.vatRatePercent.dividedBy(100)),
  );
}

/** The offered (non-optional) totals; the optional lines are shown apart. */
export function quoteTotals(blocks: readonly QuotePdfBlock[]) {
  let net = ZERO;
  let gross = ZERO;
  let optionalNet = ZERO;
  let optionalGross = ZERO;
  for (const block of blocks)
    for (const item of block.items) {
      if (item.isOptional) {
        optionalNet = optionalNet.plus(lineNet(item));
        optionalGross = optionalGross.plus(lineGross(item));
      } else {
        net = net.plus(lineNet(item));
        gross = gross.plus(lineGross(item));
      }
    }
  return { net, vat: gross.minus(net), gross, optionalNet, optionalGross };
}

/**
 * Money for the customer: forint to the whole (half up), other currencies to
 * two places, with a space every three digits (`4 800`, not `4800`: the
 * hu-HU locale would not group four digits).
 */
export function formatQuoteMoney(
  amount: Prisma.Decimal,
  currency: string,
): string {
  const huf = currency.toUpperCase() === "HUF";
  const fixed = amount
    .toDecimalPlaces(huf ? 0 : 2, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(huf ? 0 : 2);
  const negative = fixed.startsWith("-");
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const text = `${negative ? "-" : ""}${grouped}${fraction ? `,${fraction}` : ""}`;
  return huf ? `${text} Ft` : `${text} ${currency.toUpperCase()}`;
}

/** `2026-11-06` -> `2026.11.06.` */
export function formatQuoteDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${y}.${m}.${d}.`;
}

/** A quantity as people read it: decimal comma, no trailing zeros. */
export function formatQuantity(value: Prisma.Decimal): string {
  return value.toString().replace(".", ",");
}

/** The amount a line shows, per the version's price display. */
export function itemAmount(
  item: QuotePdfItem,
  display: QuotePriceDisplay,
  currency: string,
): { main: string; secondary: string | null } {
  const net = formatQuoteMoney(lineNet(item), currency);
  const gross = formatQuoteMoney(lineGross(item), currency);
  if (display === "GROSS") return { main: gross, secondary: null };
  if (display === "BOTH")
    return { main: `${net} + ÁFA`, secondary: `bruttó ${gross}` };
  return { main: `${net} + ÁFA`, secondary: null };
}

export interface PdfParagraph {
  text: string;
  /** "• " or "1. " for list items */
  marker: string | null;
}

/** The subset as printable paragraphs (one font: bold and italic are not drawn). */
export function richTextParagraphs(doc: QuoteRichText | null): PdfParagraph[] {
  if (!doc) return [];
  const out: PdfParagraph[] = [];
  const inline = (node: QuoteRichText): string =>
    node.type === "text"
      ? (node.text ?? "")
      : node.type === "hardBreak"
        ? "\n"
        : (node.content ?? []).map(inline).join("");
  const walk = (node: QuoteRichText, marker: string | null) => {
    if (node.type === "paragraph") {
      const text = inline(node);
      if (text.trim()) out.push({ text, marker });
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      (node.content ?? []).forEach((li, index) => {
        const mark = node.type === "bulletList" ? "• " : `${index + 1}. `;
        (li.content ?? []).forEach((child, childIndex) =>
          walk(child, childIndex === 0 ? mark : "   "),
        );
      });
      return;
    }
    for (const child of node.content ?? []) walk(child, marker);
  };
  walk(doc, null);
  return out;
}
