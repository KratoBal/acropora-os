import { createHash } from "node:crypto";

import { Prisma } from "@acropora/database";

import {
  A4_WIDTH,
  addPage,
  createBrandedPdf,
  PDF_BOLD_FONT,
  PDF_REGULAR_FONT,
  registerNotoSans,
} from "../../documents/pdf/branded-document.js";
import { ACROPORA_COMPANY } from "@acropora/types";
import {
  acroporaLogoHeight,
  drawAcroporaLogo,
} from "../../documents/pdf/acropora-logo.js";
import {
  formatQuantity,
  formatQuoteLongDay,
  formatQuoteMoney,
  lineGross,
  lineNet,
  quoteTotals,
  richTextParagraphs,
  vatByRate,
  type PdfParagraph,
  type QuotePdfBlock,
  type QuotePdfInput,
  type QuotePdfItem,
  type QuotePdfLanguage,
} from "./quote-pdf-layout.js";

/**
 * THE QUOTE PDF (#1582; the design: Figma FwfCAidFkuS7WVcGa2hWTN, "Acropora
 * OS — PDF dokumentumrendszer · A4", page 04 · Árajánlat, 2026-10-08). The
 * layout rules stay as they were:
 *
 *   - a section title never stays alone at a page bottom: it moves with the
 *     section's first item;
 *   - an item's description may run onto the next page (paragraph by
 *     paragraph), but its name and its price stay together;
 *   - an options block stays together when it fits on one page;
 *   - the summary never breaks: if it does not fit, it starts a new page;
 *   - a block marked `startOnNewPage` (typically the terms) starts one;
 *   - every page carries the top bar, the footer (page number, quote number
 *     and version, contact), and from page 2 the compact header (drawn after
 *     the content, `bufferPages`).
 *
 * The measures are the Figma frame's, in points (the frame is A4, 595 x 842).
 * Every height is MEASURED (`heightOfString`) before anything is drawn, and
 * nothing reads the clock: the same version renders the same bytes.
 */

const LEFT = 44;
const CONTENT_WIDTH = A4_WIDTH - 2 * LEFT;
const RIGHT_EDGE = LEFT + CONTENT_WIDTH;
const CONTINUATION_TOP = 105;
const BOTTOM = 770;
const FOOTER_RULE = 784;

/**
 * THE ITEM TABLE (Luca, 2026-11-02 11:00 UTC, card f5d25e90): one row per item,
 * the columns Name | Quantity | Net unit price | Net total (the gross columns
 * on a gross quote, and a gross total column more on a "both" quote). The name
 * column is the same width on every quote, so a description wraps the same
 * way whatever the price display.
 */
const NAME_X = LEFT + 4;
const NAME_WIDTH = 208;
const ROW_HEIGHT = 12;
const TABLE_HEAD_HEIGHT = 22;

interface Column {
  x: number;
  width: number;
  align: "left" | "right";
}

/** The right edges are the numbers' alignment: amounts line up on the digit. */
function tableColumns(display: QuotePdfInput["priceDisplay"]): {
  quantity: Column;
  unit: Column;
  total: Column;
  grossTotal: Column | null;
} {
  if (display === "BOTH")
    return {
      quantity: { x: 258, width: 50, align: "left" },
      unit: { x: 310, width: 72, align: "right" },
      total: { x: 386, width: 80, align: "right" },
      grossTotal: { x: 470, width: 76, align: "right" },
    };
  return {
    quantity: { x: 266, width: 60, align: "left" },
    unit: { x: 330, width: 100, align: "right" },
    total: { x: 436, width: 110, align: "right" },
    grossTotal: null,
  };
}

const NAVY = "#163249";
const TEAL = "#1d7085";
const MUTED = "#697782";
const BODY = "#273943";
const RULE = "#d5dfe4";
const BOX = "#f3f7f8";

const COVER_LOGO_WIDTH = 71;
const COVER_LOGO_TOP = 42;
const COMPACT_LOGO_WIDTH = 39;

const LABELS = {
  hu: {
    tagline: "TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS",
    title: "ÁRAJÁNLAT",
    requester: "Ajánlatkérő",
    subject: "Ajánlat tárgya",
    validUntil: "Érvényes:",
    options: "Opcionális tételek",
    optionsBand: "Nem részei a végösszegnek.",
    summary: "Összesítés",
    net: "Nettó összeg",
    vat: "ÁFA",
    grossTotal: "BRUTTÓ VÉGÖSSZEG",
    withoutOptions: "OPCIÓK NÉLKÜL",
    itemName: "Tétel neve",
    quantity: "Mennyiség",
    netUnit: "Nettó egységár",
    netTotalColumn: "Nettó összesen",
    grossUnit: "Bruttó egységár",
    grossTotalColumn: "Bruttó összesen",
    schedule: "Fizetési ütemezés",
    netPrefix: "nettó",
    grossPrefix: "bruttó",
    address: ACROPORA_COMPANY.address,
  },
  en: {
    tagline: "MARINE AQUARIUMS · DESIGN · INSTALLATION",
    title: "QUOTATION",
    requester: "Prepared for",
    subject: "Project",
    validUntil: "Valid until:",
    options: "Optional items",
    optionsBand: "Not included in the total.",
    summary: "Summary",
    net: "Net amount",
    vat: "VAT",
    grossTotal: "GROSS TOTAL",
    withoutOptions: "WITHOUT OPTIONS",
    itemName: "Item",
    quantity: "Quantity",
    netUnit: "Net unit price",
    netTotalColumn: "Net total",
    grossUnit: "Gross unit price",
    grossTotalColumn: "Gross total",
    schedule: "Payment schedule",
    netPrefix: "net",
    grossPrefix: "gross",
    address: "35 Pesti Gábor Street, H-1106 Budapest",
  },
} as const;

type Labels = (typeof LABELS)[QuotePdfLanguage];

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
  registerNotoSans(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const labels = LABELS[input.language ?? "hu"];
  const flow = new Flow(doc);
  drawFirstHeader(doc, input, labels, flow);

  let sectionNumber = 0;
  let summaryDrawn = false;
  input.blocks.forEach((block, index) => {
    if (block.kind === "TERMS") keepTermsTogether(doc, flow, block);
    else if (block.startOnNewPage) flow.newPageUnlessTop();
    else if (block.keepWithNext && input.blocks[index + 1])
      flow.ensure(
        headHeight(doc, block) + headHeight(doc, input.blocks[index + 1]!),
      );
    switch (block.kind) {
      case "SECTION":
        sectionNumber += 1;
        drawSection(doc, flow, input, labels, block, sectionNumber);
        break;
      case "OPTIONS":
        drawOptions(doc, flow, input, labels, block);
        break;
      case "SUMMARY":
        drawSummary(doc, flow, input, labels, block.title);
        // the payment schedule follows the summary (Figma 17:88)
        drawMilestones(doc, flow, input, labels);
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
  if (!summaryDrawn) {
    drawSummary(doc, flow, input, labels, null);
    drawMilestones(doc, flow, input, labels);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    drawTopBar(doc);
    if (i > 0) drawCompactHeader(doc, input, labels);
    drawFooter(doc, input, labels, i + 1, range.count);
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
  y = CONTINUATION_TOP;
  /** counts the pages this flow added: positions compare only within one */
  page = 1;
  constructor(private readonly doc: PDFKit.PDFDocument) {}
  ensure(height: number) {
    if (this.y + height > BOTTOM && this.y > CONTINUATION_TOP) this.newPage();
  }
  newPage() {
    addPage(this.doc);
    this.page += 1;
    this.y = CONTINUATION_TOP;
  }
  newPageUnlessTop() {
    if (this.y > CONTINUATION_TOP) this.newPage();
  }
}

type Weight = "regular" | "bold";

interface TextStyle {
  size: number;
  color: string;
  weight?: Weight;
}

function useStyle(doc: PDFKit.PDFDocument, style: TextStyle) {
  doc
    .font(style.weight === "bold" ? PDF_BOLD_FONT : PDF_REGULAR_FONT)
    .fontSize(style.size)
    .fillColor(style.color);
}

function text(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  style: TextStyle,
  width: number,
  align: "left" | "right" = "left",
) {
  useStyle(doc, style);
  doc.text(value, x, y, { width, align, lineGap: 2 });
}

function measure(
  doc: PDFKit.PDFDocument,
  value: string,
  style: TextStyle,
  width: number,
): number {
  useStyle(doc, style);
  return doc.heightOfString(value, { width, lineGap: 2 });
}

function rule(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(LEFT, y)
    .lineTo(RIGHT_EDGE, y)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
}

const TAGLINE: TextStyle = { size: 8, color: TEAL };
const DOC_TITLE: TextStyle = { size: 18, color: NAVY, weight: "bold" };
const DOC_NUMBER: TextStyle = { size: 9, color: MUTED, weight: "bold" };
const LABEL: TextStyle = { size: 8, color: MUTED };
const PARTY: TextStyle = { size: 11, color: NAVY, weight: "bold" };
const SUBJECT: TextStyle = { size: 12, color: NAVY, weight: "bold" };
const VALIDITY: TextStyle = { size: 9, color: TEAL, weight: "bold" };
const HEADING: TextStyle = { size: 11, color: TEAL, weight: "bold" };
const PARAGRAPH: TextStyle = { size: 8.6, color: BODY };
const ITEM_NAME: TextStyle = { size: 9.3, color: NAVY, weight: "bold" };
const ITEM_DESCRIPTION: TextStyle = { size: 8.35, color: BODY };
const BAND: TextStyle = { size: 8, color: TEAL, weight: "bold" };
const SUMMARY_LABEL: TextStyle = { size: 8.7, color: NAVY };
const SUMMARY_VALUE: TextStyle = { size: 9, color: NAVY };
const TOTAL_LABEL: TextStyle = { size: 9.5, color: NAVY, weight: "bold" };
const TOTAL_VALUE: TextStyle = { size: 12, color: NAVY, weight: "bold" };
const SCHEDULE_HEADING: TextStyle = { size: 10, color: TEAL, weight: "bold" };
const SCHEDULE_LABEL: TextStyle = { size: 8.7, color: BODY };
const SCHEDULE_VALUE: TextStyle = { size: 8.7, color: NAVY, weight: "bold" };
const FOOTER_TEXT: TextStyle = { size: 7, color: MUTED };
const FOOTER_REF: TextStyle = { size: 7, color: MUTED, weight: "bold" };
const PAGE_NUMBER: TextStyle = { size: 8, color: NAVY, weight: "bold" };

/**
 * THE FIRST PAGE'S HEADER (Figma "PDF / Fejléc / első oldal", 3:2): the logo
 * on the left, the tagline, the title and the number beside it. Exported for
 * the spec: the title must start below the tagline, and the rule below the
 * logo (Balázs on stage, 2026-10-08: the tagline once ran into the logo).
 */
export function coverLayout(
  top = COVER_LOGO_TOP,
  logoWidth = COVER_LOGO_WIDTH,
) {
  const logoBottom = top + acroporaLogoHeight(logoWidth);
  const tagline = top + 2;
  const title = tagline + 16;
  const number = title + 26;
  return {
    logoBottom,
    tagline,
    title,
    number,
    rule: Math.max(number + 30, logoBottom + 16),
  };
}

function drawFirstHeader(
  doc: PDFKit.PDFDocument,
  input: QuotePdfInput,
  labels: Labels,
  flow: Flow,
) {
  const at = coverLayout();
  const textX = 145;
  const textWidth = RIGHT_EDGE - textX;
  drawAcroporaLogo(doc, LEFT + 1, COVER_LOGO_TOP, COVER_LOGO_WIDTH);
  text(doc, labels.tagline, textX, at.tagline, TAGLINE, textWidth);
  text(doc, labels.title, textX, at.title, DOC_TITLE, textWidth);
  text(doc, versionRef(input), textX, at.number, DOC_NUMBER, textWidth);
  rule(doc, at.rule);

  let y = at.rule + 16;
  if (input.customer) {
    text(doc, labels.requester, LEFT, y, LABEL, CONTENT_WIDTH);
    y += 14;
    const party = [input.customer.name, ...input.customer.lines].join("\n");
    text(doc, party, LEFT, y, PARTY, CONTENT_WIDTH);
    y += measure(doc, party, PARTY, CONTENT_WIDTH) + 10;
  }
  text(doc, labels.subject, LEFT, y, LABEL, CONTENT_WIDTH);
  y += 14;
  text(doc, input.title, LEFT, y, SUBJECT, CONTENT_WIDTH);
  y += measure(doc, input.title, SUBJECT, CONTENT_WIDTH) + 14;
  const validity = `${labels.validUntil} ${formatQuoteLongDay(input.validUntil, input.language)}`;
  text(doc, validity, LEFT, y, VALIDITY, CONTENT_WIDTH);
  y += measure(doc, validity, VALIDITY, CONTENT_WIDTH) + 11;
  rule(doc, y);
  flow.y = y + 14;
}

function versionRef(input: QuotePdfInput) {
  return `${input.quoteNumber} · v${input.versionNumber}`;
}

function drawTopBar(doc: PDFKit.PDFDocument) {
  doc.rect(0, 0, A4_WIDTH, 8).fillColor(NAVY).fill();
}

/** Figma "PDF / Fejléc / folytató oldal" (3:8): the small logo and one line. */
function drawCompactHeader(
  doc: PDFKit.PDFDocument,
  input: QuotePdfInput,
  labels: Labels,
) {
  drawAcroporaLogo(doc, LEFT + 1, 26, COMPACT_LOGO_WIDTH);
  text(
    doc,
    `${labels.title} · ${versionRef(input)}`,
    107,
    30,
    { size: 11, color: NAVY, weight: "bold" },
    RIGHT_EDGE - 107,
  );
  rule(doc, 76);
}

/** A block heading: teal capitals over a rule (Figma 18:6, 18:42). */
function headingHeight(
  doc: PDFKit.PDFDocument,
  title: string,
  style = HEADING,
): number {
  return measure(doc, title.toUpperCase(), style, CONTENT_WIDTH) + 15;
}

function drawHeading(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  title: string,
  style = HEADING,
) {
  const upper = title.toUpperCase();
  text(doc, upper, LEFT, flow.y, style, CONTENT_WIDTH);
  const ruleY = flow.y + measure(doc, upper, style, CONTENT_WIDTH) + 6;
  rule(doc, ruleY);
  flow.y = ruleY + 9;
}

function paragraphHeight(
  doc: PDFKit.PDFDocument,
  p: PdfParagraph,
  style: TextStyle,
  width: number,
) {
  return measure(doc, `${p.marker ?? ""}${p.text}`, style, width) + 4;
}

function drawParagraphs(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  paragraphs: PdfParagraph[],
  style: TextStyle,
  x: number,
  width: number,
) {
  for (const p of paragraphs) {
    const h = paragraphHeight(doc, p, style, width);
    flow.ensure(h);
    text(doc, `${p.marker ?? ""}${p.text}`, x, flow.y, style, width);
    flow.y += h;
  }
}

/** The part of a block that must not be left alone at a page bottom. */
function headHeight(doc: PDFKit.PDFDocument, block: QuotePdfBlock): number {
  const title = block.title ? headingHeight(doc, block.title) : 0;
  const first = block.items[0];
  return title + (first ? TABLE_HEAD_HEIGHT + rowHeadHeight(doc, first) : 0);
}

/**
 * THE TERMS, AS ONE BLOCK (Balázs, 2026-10-08 15:13 UTC, the Figma thread:
 * "a feltételek ha ráférnek az utolsó lapra akkor én nem raknám külön
 * oldalra"). They continue on the current page when they fit there whole, and
 * start a new page when they do not; `startOnNewPage` does not force one. A
 * terms block longer than a page starts a page and runs on (`drawText` keeps
 * its title with the first paragraph).
 */
function keepTermsTogether(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  block: QuotePdfBlock,
) {
  const height = textBlockHeight(doc, block);
  if (height <= BOTTOM - CONTINUATION_TOP) flow.ensure(height);
  else flow.newPageUnlessTop();
}

function textBlockHeight(doc: PDFKit.PDFDocument, block: QuotePdfBlock) {
  return (
    (block.title ? headingHeight(doc, block.title) : 0) +
    richTextParagraphs(block.content).reduce(
      (h, p) => h + paragraphHeight(doc, p, PARAGRAPH, CONTENT_WIDTH),
      0,
    )
  );
}

function drawText(doc: PDFKit.PDFDocument, flow: Flow, block: QuotePdfBlock) {
  const paragraphs = richTextParagraphs(block.content);
  if (block.title) {
    const first = paragraphs[0];
    flow.ensure(
      headingHeight(doc, block.title) +
        (first ? paragraphHeight(doc, first, PARAGRAPH, CONTENT_WIDTH) : 0),
    );
    drawHeading(doc, flow, block.title);
  }
  drawParagraphs(doc, flow, paragraphs, PARAGRAPH, LEFT, CONTENT_WIDTH);
  flow.y += 10;
}

/**
 * ONE ROW OF THE ITEM TABLE: the name (bold) with its description under it,
 * and on the name's first line the quantity with its unit, the unit price and
 * the line total. The price columns say what they are in the header (net or
 * gross), so the cells carry no "+ ÁFA" or "nettó" any more.
 */
function rowCells(
  item: QuotePdfItem,
  input: QuotePdfInput,
  prefix: string,
): { quantity: string; unit: string; total: string; grossTotal: string | null } {
  const money = (v: Parameters<typeof formatQuoteMoney>[0]) =>
    formatQuoteMoney(v, input.currency);
  const gross = input.priceDisplay === "GROSS";
  const unit = gross
    ? lineGross({ ...item, quantity: new Prisma.Decimal(1) })
    : item.unitNetPrice;
  return {
    quantity: `${formatQuantity(item.quantity)} ${item.unit}`,
    unit: money(unit),
    total: `${prefix}${money(gross ? lineGross(item) : lineNet(item))}`,
    grossTotal:
      input.priceDisplay === "BOTH" ? `${prefix}${money(lineGross(item))}` : null,
  };
}

const HEAD_CELL: TextStyle = { size: 7.6, color: MUTED, weight: "bold" };
const CELL: TextStyle = { size: 9, color: BODY };
const CELL_TOTAL: TextStyle = { size: 9.3, color: NAVY, weight: "bold" };

/** The column headers over the rows; they name net or gross, so every price says which. */
function drawTableHead(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
) {
  const cols = tableColumns(input.priceDisplay);
  const gross = input.priceDisplay === "GROSS";
  const y = flow.y;
  text(doc, labels.itemName, NAME_X, y, HEAD_CELL, NAME_WIDTH);
  text(doc, labels.quantity, cols.quantity.x, y, HEAD_CELL, cols.quantity.width);
  text(
    doc,
    gross ? labels.grossUnit : labels.netUnit,
    cols.unit.x,
    y,
    HEAD_CELL,
    cols.unit.width,
    "right",
  );
  text(
    doc,
    gross ? labels.grossTotalColumn : labels.netTotalColumn,
    cols.total.x,
    y,
    HEAD_CELL,
    cols.total.width,
    "right",
  );
  if (cols.grossTotal)
    text(
      doc,
      labels.grossTotalColumn,
      cols.grossTotal.x,
      y,
      HEAD_CELL,
      cols.grossTotal.width,
      "right",
    );
  rule(doc, y + 14);
  flow.y = y + TABLE_HEAD_HEIGHT;
}

/** The height of a row's first line: what must stay together with the head and the next row. */
function rowHeadHeight(doc: PDFKit.PDFDocument, item: QuotePdfItem): number {
  return Math.max(measure(doc, item.name, ITEM_NAME, NAME_WIDTH), ROW_HEIGHT) + 14;
}

function drawItem(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  item: QuotePdfItem,
  prefix = "",
) {
  const cols = tableColumns(input.priceDisplay);
  const cells = rowCells(item, input, prefix);
  const nameHeight = measure(doc, item.name, ITEM_NAME, NAME_WIDTH);
  const paragraphs = richTextParagraphs(item.description);
  const first = paragraphs[0];
  // the name and its prices together, with the first paragraph of the description
  flow.ensure(
    Math.max(nameHeight, ROW_HEIGHT) +
      (first
        ? paragraphHeight(doc, first, ITEM_DESCRIPTION, NAME_WIDTH - 3)
        : 0),
  );
  const top = flow.y;
  text(doc, item.name, NAME_X, top, ITEM_NAME, NAME_WIDTH);
  text(doc, cells.quantity, cols.quantity.x, top, CELL, cols.quantity.width);
  text(doc, cells.unit, cols.unit.x, top, CELL, cols.unit.width, "right");
  text(doc, cells.total, cols.total.x, top, CELL_TOTAL, cols.total.width, "right");
  if (cols.grossTotal && cells.grossTotal)
    text(
      doc,
      cells.grossTotal,
      cols.grossTotal.x,
      top,
      CELL_TOTAL,
      cols.grossTotal.width,
      "right",
    );
  flow.y = top + Math.max(nameHeight, ROW_HEIGHT) + (first ? 3 : 0);
  // the description may continue on the next page, paragraph by paragraph
  drawParagraphs(
    doc,
    flow,
    paragraphs,
    ITEM_DESCRIPTION,
    NAME_X,
    NAME_WIDTH - 3,
  );
  const ruleY = flow.y + 5;
  rule(doc, ruleY);
  flow.y = ruleY + 8;
}

/**
 * THE ROWS OF A TABLE, with the head over the first one and again at the top
 * of every page the rows run onto (a continued table without its head is a
 * column of unlabelled numbers).
 */
function drawTable(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
  items: QuotePdfItem[],
  prefixOf: (item: QuotePdfItem) => string,
) {
  if (!items.length) return;
  flow.ensure(TABLE_HEAD_HEIGHT + rowHeadHeight(doc, items[0]!));
  drawTableHead(doc, flow, input, labels);
  let headPage = flow.page;
  for (const item of items) {
    flow.ensure(rowHeadHeight(doc, item));
    if (flow.page !== headPage) {
      drawTableHead(doc, flow, input, labels);
      headPage = flow.page;
    }
    drawItem(doc, flow, input, item, prefixOf(item));
    // a description that ran onto the next page leaves the cursor there
    headPage = Math.max(headPage, flow.page);
  }
}

function drawSection(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
  block: QuotePdfBlock,
  number: number,
) {
  const title = `${number}.  ${block.title ?? ""}`.trim();
  const intro = richTextParagraphs(block.content);
  const first = block.items[0];
  // the title moves with its first item (and the intro before it)
  flow.ensure(
    headingHeight(doc, title) +
      intro.reduce(
        (h, p) => h + paragraphHeight(doc, p, PARAGRAPH, CONTENT_WIDTH),
        0,
      ) +
      (first ? TABLE_HEAD_HEIGHT + rowHeadHeight(doc, first) : 0),
  );
  drawHeading(doc, flow, title);
  if (intro.length) {
    drawParagraphs(doc, flow, intro, PARAGRAPH, LEFT, CONTENT_WIDTH);
    flow.y += 4;
  }
  drawTable(doc, flow, input, labels, block.items, (item) =>
    item.isOptional ? "+" : "",
  );
  flow.y += 6;
}

const BAND_HEIGHT = 25;

function drawOptions(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
  block: QuotePdfBlock,
) {
  const title = block.title ?? labels.options;
  const itemHeight = (item: QuotePdfItem) =>
    Math.max(measure(doc, item.name, ITEM_NAME, NAME_WIDTH), ROW_HEIGHT) +
    richTextParagraphs(item.description).reduce(
      (h, p) => h + paragraphHeight(doc, p, ITEM_DESCRIPTION, NAME_WIDTH - 3),
      0,
    ) +
    13;
  const head = headingHeight(doc, title) + BAND_HEIGHT + 9 + TABLE_HEAD_HEIGHT;
  const total = head + block.items.reduce((h, item) => h + itemHeight(item), 0);
  // the whole block together when it fits on one page
  if (total <= BOTTOM - CONTINUATION_TOP) flow.ensure(total);
  else
    flow.ensure(
      head + (block.items[0] ? rowHeadHeight(doc, block.items[0]) : 0),
    );
  drawHeading(doc, flow, title);
  doc
    .roundedRect(LEFT, flow.y, CONTENT_WIDTH, BAND_HEIGHT, 3)
    .fillColor(BOX)
    .fill();
  text(
    doc,
    labels.optionsBand,
    LEFT + 11,
    flow.y + 7,
    BAND,
    CONTENT_WIDTH - 22,
  );
  flow.y += BAND_HEIGHT + 9;
  drawTable(doc, flow, input, labels, block.items, () => "");
  flow.y += 6;
}

const SUMMARY_ROW = 19;
const SUMMARY_PAD = 10;

/**
 * THE SUMMARY (Figma 18:19, Luca 2026-11-02): the net amount, the VAT of each
 * rate that occurs, each on its own row, and the gross total under them, on
 * every quote whatever the price display (a net quote used to end on "net +
 * ÁFA" alone; Luca asked for the three amounts, the net table columns now say
 * which prices are net). "Without options" only when the quote has options.
 * The box ends where its last row ends (the brief: no empty space at the
 * bottom, a fault of the Figma frame). It never breaks.
 */
function drawSummary(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
  title: string | null,
) {
  const totals = quoteTotals(input.blocks);
  const hasOptions = input.blocks.some((b) =>
    b.items.some((item) => item.isOptional),
  );
  const money = (v: Parameters<typeof formatQuoteMoney>[0]) =>
    formatQuoteMoney(v, input.currency);
  const rows: Array<[string, string]> = [
    [labels.net, money(totals.net)],
    ...vatByRate(input.blocks).map((r): [string, string] => [
      `${labels.vat} ${r.rate.toString().replace(".", ",")}%`,
      money(r.vat),
    ]),
  ];
  const totalLabel = `${labels.grossTotal}${hasOptions ? ` · ${labels.withoutOptions}` : ""}`;
  const totalValue = money(totals.gross);
  const boxHeight =
    SUMMARY_PAD +
    rows.length * SUMMARY_ROW +
    measure(doc, totalValue, TOTAL_VALUE, 156) +
    SUMMARY_PAD;
  const heading = headingHeight(doc, title ?? labels.summary);
  // the summary never breaks
  flow.ensure(heading + boxHeight);
  drawHeading(doc, flow, title ?? labels.summary);
  const top = flow.y;
  doc.roundedRect(LEFT, top, CONTENT_WIDTH, boxHeight, 4).fillColor(BOX).fill();
  const labelX = LEFT + 14;
  const valueX = LEFT + 330;
  let y = top + SUMMARY_PAD;
  for (const [label, value] of rows) {
    text(doc, label, labelX, y, SUMMARY_LABEL, 300);
    text(doc, value, valueX, y, SUMMARY_VALUE, 156, "right");
    y += SUMMARY_ROW;
  }
  text(doc, totalLabel, labelX, y + 1, TOTAL_LABEL, 320);
  text(doc, totalValue, valueX, y - 1, TOTAL_VALUE, 156, "right");
  flow.y = top + boxHeight + 20;
}

/**
 * THE PAYMENT SCHEDULE (Figma 18:29): each milestone with its amount, the
 * share of the total the summary shows (the gross total).
 */
function drawMilestones(
  doc: PDFKit.PDFDocument,
  flow: Flow,
  input: QuotePdfInput,
  labels: Labels,
) {
  if (!input.milestones.length) return;
  const totals = quoteTotals(input.blocks);
  const base = totals.gross;
  const rows = input.milestones.map((m) => ({
    label: `${m.label} ${m.percent.toString().replace(".", ",")}%`,
    value: formatQuoteMoney(
      base.times(m.percent).dividedBy(100),
      input.currency,
    ),
  }));
  flow.ensure(
    headingHeight(doc, labels.schedule, SCHEDULE_HEADING) + rows.length * 24,
  );
  drawHeading(doc, flow, labels.schedule, SCHEDULE_HEADING);
  for (const row of rows) {
    text(doc, row.label, LEFT + 6, flow.y, SCHEDULE_LABEL, 335);
    text(doc, row.value, LEFT + 365, flow.y, SCHEDULE_VALUE, 135);
    flow.y += 24;
  }
  flow.y += 10;
}

/** Figma "PDF / Lábléc / általános" (3:13). */
function drawFooter(
  doc: PDFKit.PDFDocument,
  input: QuotePdfInput,
  labels: Labels,
  page: number,
  pages: number,
) {
  rule(doc, FOOTER_RULE);
  const c = ACROPORA_COMPANY;
  text(
    doc,
    `${c.name} · ${labels.tagline}`,
    LEFT,
    FOOTER_RULE + 6,
    FOOTER_TEXT,
    CONTENT_WIDTH - 60,
  );
  text(
    doc,
    `${labels.address} · ${c.phone} · ${c.web} · ${c.email}`,
    LEFT,
    FOOTER_RULE + 20,
    { ...FOOTER_TEXT, size: 6.7 },
    CONTENT_WIDTH - 60,
  );
  text(doc, versionRef(input), LEFT, FOOTER_RULE + 33, FOOTER_REF, 350);
  text(
    doc,
    `${page} / ${pages}`,
    RIGHT_EDGE - 55,
    FOOTER_RULE + 20,
    PAGE_NUMBER,
    55,
    "right",
  );
}
