import { createHash } from "node:crypto";

import {
  A4_WIDTH,
  addPage,
  createBrandedPdf,
  PDF_CONTENT_WIDTH,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  PDF_RIGHT,
  PDF_RULE,
} from "../../documents/pdf/branded-document.js";
import { acroporaFooterLine } from "@acropora/types";
import {
  acroporaLogoHeight,
  drawAcroporaLogo,
} from "../../documents/pdf/acropora-logo.js";
import {
  formatQuantity,
  formatQuoteDay,
  formatQuoteMoney,
  itemAmount,
  quoteTotals,
  richTextParagraphs,
  type PdfParagraph,
  type QuotePdfBlock,
  type QuotePdfInput,
  type QuotePdfItem,
} from "./quote-pdf-layout.js";

/**
 * THE QUOTE PDF (#1582 P2; Figma 35 · OS / Offers / Final PDF Design,
 * 579:2898). The layout rules, as the design states them:
 *
 *   - a section title never stays alone at a page bottom: it moves with the
 *     section's first item;
 *   - an item's description may run onto the next page (paragraph by
 *     paragraph), but its name and its price stay together;
 *   - an options block stays together when it fits on one page;
 *   - the summary never breaks: if it does not fit, it starts a new page;
 *   - a block marked `startOnNewPage` (typically the terms) starts one;
 *   - every page carries the page number, the quote number and version and
 *     the Acropora footer (drawn after the content, `bufferPages`).
 *
 * Every height is MEASURED (`heightOfString`) before anything is drawn, and
 * nothing reads the clock: the creation date is the publish request time, so
 * the same version renders the same bytes.
 */

const TOP = 54;
const BOTTOM = 770;
const FOOTER_Y = 792;
const AMOUNT_WIDTH = 150;
const TEXT_WIDTH = PDF_CONTENT_WIDTH - AMOUNT_WIDTH - 16;
const TEAL = "#0b7a6e";
const BOX = "#eef1f4";

export interface RenderedQuotePdf {
  bytes: Buffer;
  sha256: string;
  pageCount: number;
}

export function renderQuotePdf(
  input: QuotePdfInput,
  options: { fontPath?: string } = {},
): Promise<RenderedQuotePdf> {
  const doc = createBrandedPdf({
    fontPath: options.fontPath,
    creationDate: input.creationDate,
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const flow = new Flow(doc);
  drawFirstHeader(doc, input, flow);

  let sectionNumber = 0;
  let summaryDrawn = false;
  input.blocks.forEach((block, index) => {
    if (block.startOnNewPage) flow.newPageUnlessTop();
    else if (block.keepWithNext && input.blocks[index + 1])
      flow.ensure(
        headHeight(doc, block) + headHeight(doc, input.blocks[index + 1]!),
      );
    switch (block.kind) {
      case "SECTION":
        sectionNumber += 1;
        drawSection(doc, flow, input, block, sectionNumber);
        break;
      case "OPTIONS":
        drawOptions(doc, flow, input, block);
        break;
      case "SUMMARY":
        drawSummary(doc, flow, input, block.title);
        summaryDrawn = true;
        break;
      case "PAGE_BREAK":
        flow.newPageUnlessTop();
        break;
      case "TEXT":
      case "TERMS":
        drawText(doc, flow, block);
        break;
      default:
        // IMAGE: no upload path yet (P1), nothing to draw
        break;
    }
  });
  if (!summaryDrawn) drawSummary(doc, flow, input, null);
  drawMilestones(doc, flow, input);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    drawFooter(doc, input, i + 1, range.count);
  }
  const pageCount = range.count;
  doc.end();
  return done.then((bytes) => ({
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    pageCount,
  }));
}

/** The vertical cursor, and the one place a page is added. */
class Flow {
  y = TOP;
  constructor(private readonly doc: PDFKit.PDFDocument) {}
  ensure(height: number) {
    if (this.y + height > BOTTOM && this.y > TOP) this.newPage();
  }
  newPage() {
    addPage(this.doc);
    this.y = TOP;
  }
  newPageUnlessTop() {
    if (this.y > TOP) this.newPage();
  }
}

function text(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  width: number,
  align: "left" | "right" = "left",
) {
  doc
    .fillColor(color)
    .fontSize(size)
    .text(value, x, y, { width, align, lineGap: 2 });
}

function measure(
  doc: PDFKit.PDFDocument,
  value: string,
  size: number,
  width: number,
): number {
  doc.fontSize(size);
  return doc.heightOfString(value, { width, lineGap: 2 });
}

const COVER_LOGO_WIDTH = 120;

/**
 * THE FIRST PAGE'S HEADER, TOP TO BOTTOM. Everything below the logo starts
 * from the logo's own height (Balázs on stage, 2026-10-08: the tagline sat
 * at a fixed TOP + 40 and ran into the "acropora" word of a 68 pt tall logo).
 */
export function coverLayout(top = TOP, logoWidth = COVER_LOGO_WIDTH) {
  const logoBottom = top + acroporaLogoHeight(logoWidth);
  const tagline = logoBottom + 8;
  const title = tagline + 22;
  const number = title + 30;
  return { logoBottom, tagline, title, number, rule: number + 24 };
}

function drawFirstHeader(
  doc: PDFKit.PDFDocument,
  input: QuotePdfInput,
  flow: Flow,
) {
  const at = coverLayout();
  drawAcroporaLogo(doc, PDF_LEFT, TOP, COVER_LOGO_WIDTH);
  text(
    doc,
    "TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS",
    PDF_LEFT,
    at.tagline,
    7.5,
    PDF_MUTED,
    PDF_CONTENT_WIDTH,
  );
  text(doc, "ÁRAJÁNLAT", PDF_LEFT, at.title, 22, PDF_INK, PDF_CONTENT_WIDTH);
  text(
    doc,
    `${input.quoteNumber} · v${input.versionNumber}`,
    PDF_LEFT,
    at.number,
    10.5,
    TEAL,
    PDF_CONTENT_WIDTH,
  );
  const ruleY = at.rule;
  doc
    .moveTo(PDF_LEFT, ruleY)
    .lineTo(A4_WIDTH - PDF_RIGHT, ruleY)
    .strokeColor(PDF_RULE)
    .lineWidth(0.75)
    .stroke();
  let y = ruleY + 18;
  const lines = [
    ...(input.customer ? [input.customer.name, ...input.customer.lines] : []),
    input.title,
    `Érvényes: ${formatQuoteDay(input.validUntil)}`,
  ];
  for (const line of lines) {
    text(doc, line, PDF_LEFT, y, 10, PDF_INK, PDF_CONTENT_WIDTH);
    y += measure(doc, line, 10, PDF_CONTENT_WIDTH) + 2;
  }
  flow.y = y + 18;
}

function paragraphHeight(
  doc: PDFKit.PDFDocument,
  p: PdfParagraph,
  size: number,
  width: number,
) {
  return measure(doc, `${p.marker ?? ""}${p.text}`, size, width) + 4;
}

function drawParagraphs(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  paragraphs: PdfParagraph[],
  size: number,
  color: string,
  width: number,
) {
  for (const p of paragraphs) {
    const h = paragraphHeight(doc, p, size, width);
    flow.ensure(h);
    text(
      doc,
      `${p.marker ?? ""}${p.text}`,
      PDF_LEFT,
      flow.y,
      size,
      color,
      width,
    );
    flow.y += h;
  }
}

/** The part of a block that must not be left alone at a page bottom. */
function headHeight(doc: PDFKit.PDFDocument, block: QuotePdfBlock): number {
  const title = block.title
    ? measure(doc, block.title, 11, PDF_CONTENT_WIDTH) + 10
    : 0;
  const first = block.items[0];
  return title + (first ? itemHeadHeight(doc, first) : 0);
}

function itemHeadHeight(doc: PDFKit.PDFDocument, item: QuotePdfItem): number {
  return Math.max(measure(doc, item.name, 10.5, TEXT_WIDTH), 26) + 8;
}

function drawText(doc: PDFKit.PDFDocument, flow: Flow, block: QuotePdfBlock) {
  const paragraphs = richTextParagraphs(block.content);
  if (block.title) {
    const first = paragraphs[0];
    flow.ensure(
      measure(doc, block.title, 11, PDF_CONTENT_WIDTH) +
        8 +
        (first ? paragraphHeight(doc, first, 10, PDF_CONTENT_WIDTH) : 0),
    );
    text(doc, block.title, PDF_LEFT, flow.y, 11, PDF_INK, PDF_CONTENT_WIDTH);
    flow.y += measure(doc, block.title, 11, PDF_CONTENT_WIDTH) + 8;
  }
  drawParagraphs(doc, flow, paragraphs, 10, PDF_INK, PDF_CONTENT_WIDTH);
  flow.y += 14;
}

function drawItem(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  item: QuotePdfItem,
  prefix = "",
) {
  const amount = itemAmount(item, input.priceDisplay, input.currency);
  const qty = item.quantity.eq(1)
    ? null
    : `${formatQuantity(item.quantity)} ${item.unit} × ${formatQuoteMoney(item.unitNetPrice, input.currency)}`;
  const nameHeight = measure(doc, item.name, 10.5, TEXT_WIDTH);
  const amountHeight = 14 + (amount.secondary ? 12 : 0) + (qty ? 12 : 0);
  // name and price together
  flow.ensure(Math.max(nameHeight, amountHeight) + 6);
  const top = flow.y;
  text(doc, item.name, PDF_LEFT, top, 10.5, PDF_INK, TEXT_WIDTH);
  const x = A4_WIDTH - PDF_RIGHT - AMOUNT_WIDTH;
  text(
    doc,
    `${prefix}${amount.main}`,
    x,
    top,
    10.5,
    PDF_INK,
    AMOUNT_WIDTH,
    "right",
  );
  let ay = top + 14;
  if (amount.secondary) {
    text(doc, amount.secondary, x, ay, 8.5, PDF_MUTED, AMOUNT_WIDTH, "right");
    ay += 12;
  }
  if (qty) text(doc, qty, x, ay, 8, PDF_MUTED, AMOUNT_WIDTH, "right");
  flow.y = top + Math.max(nameHeight + 4, amountHeight);
  // the description may continue on the next page, paragraph by paragraph
  drawParagraphs(
    doc,
    flow,
    richTextParagraphs(item.description),
    8.5,
    PDF_MUTED,
    TEXT_WIDTH,
  );
  flow.y += 10;
}

function drawSection(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  block: QuotePdfBlock,
  number: number,
) {
  const title = `${number}. ${block.title ?? ""}`.trim();
  const intro = richTextParagraphs(block.content);
  const first = block.items[0];
  // the title moves with its first item (and the intro before it)
  flow.ensure(
    measure(doc, title, 11, PDF_CONTENT_WIDTH) +
      10 +
      intro.reduce(
        (h, p) => h + paragraphHeight(doc, p, 8.5, PDF_CONTENT_WIDTH),
        0,
      ) +
      (first ? itemHeadHeight(doc, first) : 0),
  );
  text(doc, title, PDF_LEFT, flow.y, 11, PDF_INK, PDF_CONTENT_WIDTH);
  flow.y += measure(doc, title, 11, PDF_CONTENT_WIDTH) + 8;
  drawParagraphs(doc, flow, intro, 8.5, PDF_MUTED, PDF_CONTENT_WIDTH);
  flow.y += 6;
  for (const item of block.items)
    drawItem(doc, flow, input, item, item.isOptional ? "+" : "");
  flow.y += 10;
}

function drawOptions(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  block: QuotePdfBlock,
) {
  const title = block.title ?? "Opcionális tételek";
  const rows = block.items.map((item) => ({
    item,
    amount: `+${itemAmount(item, input.priceDisplay, input.currency).main}`,
  }));
  const rowHeight = (name: string) => measure(doc, name, 10, TEXT_WIDTH) + 6;
  const total =
    measure(doc, title, 11, PDF_CONTENT_WIDTH) +
    12 +
    rows.reduce((h, r) => h + rowHeight(r.item.name), 0);
  // the whole block together when it fits on one page
  if (total <= BOTTOM - TOP) flow.ensure(total);
  else
    flow.ensure(
      measure(doc, title, 11, PDF_CONTENT_WIDTH) +
        12 +
        (rows[0] ? rowHeight(rows[0].item.name) : 0),
    );
  text(doc, title, PDF_LEFT, flow.y, 11, PDF_INK, PDF_CONTENT_WIDTH);
  flow.y += measure(doc, title, 11, PDF_CONTENT_WIDTH) + 10;
  for (const row of rows) {
    const h = rowHeight(row.item.name);
    flow.ensure(h);
    text(doc, row.item.name, PDF_LEFT, flow.y, 10, PDF_INK, TEXT_WIDTH);
    text(
      doc,
      row.amount,
      A4_WIDTH - PDF_RIGHT - AMOUNT_WIDTH,
      flow.y,
      10,
      PDF_INK,
      AMOUNT_WIDTH,
      "right",
    );
    flow.y += h;
  }
  flow.y += 16;
}

function drawSummary(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  title: string | null,
) {
  const totals = quoteTotals(input.blocks);
  const hasOptions = totals.optionalNet.gt(0);
  const rows: Array<[string, string]> =
    input.priceDisplay === "BOTH"
      ? [
          ["Nettó", formatQuoteMoney(totals.net, input.currency)],
          ["ÁFA", formatQuoteMoney(totals.vat, input.currency)],
        ]
      : [];
  const label =
    title ??
    (input.priceDisplay === "NET"
      ? "Ajánlat nettó összege"
      : "Ajánlat bruttó összege");
  const big = formatQuoteMoney(
    input.priceDisplay === "NET" ? totals.net : totals.gross,
    input.currency,
  );
  const height = 64 + rows.length * 16 + (hasOptions ? 14 : 0);
  // the summary never breaks
  flow.ensure(height + 10);
  const top = flow.y;
  doc
    .roundedRect(PDF_LEFT, top, PDF_CONTENT_WIDTH, height, 6)
    .fillColor(BOX)
    .fill();
  text(doc, label, PDF_LEFT + 14, top + 16, 10.5, PDF_INK, 230);
  text(
    doc,
    big,
    PDF_LEFT + 230,
    top + 10,
    20,
    PDF_INK,
    PDF_CONTENT_WIDTH - 244,
    "right",
  );
  let y = top + 42;
  for (const [name, value] of rows) {
    text(doc, name, PDF_LEFT + 14, y, 9, PDF_MUTED, 200);
    text(
      doc,
      value,
      PDF_LEFT + 230,
      y,
      9,
      PDF_MUTED,
      PDF_CONTENT_WIDTH - 244,
      "right",
    );
    y += 16;
  }
  text(
    doc,
    input.priceDisplay === "NET"
      ? "Az árak az ÁFA-t nem tartalmazzák. Opciók nélkül."
      : "Opciók nélkül.",
    PDF_LEFT + 14,
    y,
    8.5,
    PDF_MUTED,
    PDF_CONTENT_WIDTH - 28,
  );
  if (hasOptions) {
    const optional = formatQuoteMoney(
      input.priceDisplay === "NET" ? totals.optionalNet : totals.optionalGross,
      input.currency,
    );
    text(
      doc,
      `Választható opciók összesen: +${optional}`,
      PDF_LEFT + 14,
      y + 14,
      8.5,
      PDF_MUTED,
      PDF_CONTENT_WIDTH - 28,
    );
  }
  flow.y = top + height + 20;
}

function drawMilestones(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
) {
  if (!input.milestones.length) return;
  const rows = input.milestones.map(
    (m) => `${m.label}: ${m.percent.toString().replace(".", ",")}%`,
  );
  const height = 24 + rows.length * 16;
  flow.ensure(height);
  text(
    doc,
    "Fizetési ütemezés",
    PDF_LEFT,
    flow.y,
    11,
    PDF_INK,
    PDF_CONTENT_WIDTH,
  );
  flow.y += 20;
  for (const row of rows) {
    text(doc, row, PDF_LEFT, flow.y, 10, PDF_INK, PDF_CONTENT_WIDTH);
    flow.y += 16;
  }
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  input: QuotePdfInput,
  page: number,
  pages: number,
) {
  doc
    .moveTo(PDF_LEFT, FOOTER_Y - 10)
    .lineTo(A4_WIDTH - PDF_RIGHT, FOOTER_Y - 10)
    .strokeColor(PDF_RULE)
    .lineWidth(0.75)
    .stroke();
  // the company line stays ONE line beside the page number: the font
  // shrinks until it fits (Balázs's wording is long, 2026-10-08)
  const line = acroporaFooterLine(
    `${input.quoteNumber} · v${input.versionNumber}`,
  );
  const width = PDF_CONTENT_WIDTH - 50;
  let size = 7.5;
  while (size > 5.5 && doc.fontSize(size).widthOfString(line) > width)
    size -= 0.25;
  text(doc, line, PDF_LEFT, FOOTER_Y, size, PDF_MUTED, width);
  text(
    doc,
    `${page} / ${pages}`,
    A4_WIDTH - PDF_RIGHT - 40,
    FOOTER_Y,
    7.5,
    PDF_MUTED,
    40,
    "right",
  );
}
