import {
  ACROPORA_COMPANY,
  type MeasurementRecommendationSegment,
} from "@acropora/types";

import {
  A4_WIDTH,
  addPage,
  createBrandedPdf,
  PDF_BODY_FONT,
  PDF_BOLD_FONT,
  PDF_REGULAR_FONT,
  registerNotoSans,
} from "../documents/pdf/branded-document.js";
import { drawAcroporaLogo } from "../documents/pdf/acropora-logo.js";
import type { ReportRow } from "./measurement-report.js";

/**
 * THE MEASUREMENT REPORT PDF (card 77767969; Figma FwfCAidFkuS7WVcGa2hWTN,
 * 06 · Mérési eredmények és ICP elemzés, 2:470). The measures are the Figma
 * frame's, in points. The rows and their marks come ready from
 * `measurement-report.ts`; this file only draws them.
 *
 * THE MARKS ARE DRAWN IN DEJAVU SANS. Noto Sans has no ✓, ↓ and ↑ (measured
 * with fontkit, 2026-10-08), and pdfkit draws a missing glyph as an empty box
 * without a word. The shared body font (DejaVu Sans, registered by
 * `createBrandedPdf`) has all three.
 */

export interface MeasurementReportPdfInput {
  /** "Customer · aquarium", or the aquarium alone */
  partner: string;
  /** "190 liter · 2026. október 8. 10:45", or the date alone */
  volumeAndMoment: string;
  examination: string;
  rows: ReportRow[];
  icp: { title: string; rows: ReportRow[] } | null;
  deviations: number;
  notes: string | null;
  /**
   * The APPROVED product recommendation (card 2b3983e1), as the customer sees
   * it; a draft never reaches the PDF. `null` or empty: no block.
   */
  recommendation?: MeasurementRecommendationSegment[] | null;
}

const LEFT = 44;
const CONTENT_WIDTH = A4_WIDTH - 2 * LEFT;
const RIGHT_EDGE = LEFT + CONTENT_WIDTH;
const CONTINUATION_TOP = 70;
const BOTTOM = 770;
const FOOTER_RULE = 787;

const NAVY = "#143149";
const TEAL = "#1d7085";
const MUTED = "#687986";
const BODY = "#263640";
const RULE = "#d5dee3";
const BOX = "#f3f7f8";
const WARN = "#98520d";
const ALERT = "#b4232f";

const COLUMNS = [51, 179, 270, 355, 453] as const;
const COLUMN_WIDTHS = [120, 82, 77, 90, 95] as const;
const ROW_HEIGHT = 28;
const HEAD_HEIGHT = 27;

const TREND_WORD = {
  IMPROVING: "javul",
  WORSENING: "romlik",
  STABLE: "stabil",
} as const;

export function renderMeasurementReportPdf(
  input: MeasurementReportPdfInput,
): Promise<Buffer> {
  const doc = createBrandedPdf();
  registerNotoSans(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let y = drawHeader(doc, input);
  const newPage = () => {
    addPage(doc);
    y = CONTINUATION_TOP;
  };
  const ensure = (height: number) => {
    if (y + height > BOTTOM) newPage();
  };

  y = heading(doc, "Akvárium és mérés", y);
  for (const [label, value] of [
    ["Partner / akvárium", input.partner],
    ["Vízterfogat / dátum", input.volumeAndMoment],
    ["Vizsgálat", input.examination],
  ] as const) {
    write(doc, label, LEFT, y, { size: 8, color: MUTED }, 172);
    write(doc, value, LEFT + 172, y, { size: 9, color: BODY, bold: true }, 330);
    y += 31;
  }
  y += 17;

  const table = (title: string, rows: ReportRow[], firstColumn: string) => {
    ensure(headingHeight + HEAD_HEIGHT + ROW_HEIGHT);
    y = heading(doc, title, y);
    const drawHead = () => {
      doc
        .roundedRect(LEFT, y, CONTENT_WIDTH, HEAD_HEIGHT, 2)
        .fillColor(NAVY)
        .fill();
      [firstColumn, "Mért", "Előző", "Célérték", "Eltérés / tendencia"].forEach(
        (text, i) =>
          write(
            doc,
            text,
            COLUMNS[i]!,
            y + 7,
            { size: 7.6, color: "#ffffff", bold: true },
            COLUMN_WIDTHS[i]!,
          ),
      );
      y += HEAD_HEIGHT;
    };
    drawHead();
    rows.forEach((row, index) => {
      if (y + ROW_HEIGHT > BOTTOM) {
        newPage();
        drawHead();
      }
      if (index % 2 === 0)
        doc.rect(LEFT, y, CONTENT_WIDTH, ROW_HEIGHT).fillColor(BOX).fill();
      const color =
        row.status === "ALERT" ? ALERT : row.status === "WARN" ? WARN : BODY;
      const style = { size: 7.4, color, bold: row.status === "ALERT" };
      const cells = [
        row.label,
        row.measured,
        row.previous ?? "–",
        row.target ?? "–",
      ];
      cells.forEach((text, i) =>
        write(doc, text, COLUMNS[i]!, y + 9, style, COLUMN_WIDTHS[i]!),
      );
      drawDeviation(doc, row, COLUMNS[4], y + 9, { ...style, size: 7.2 });
      y += ROW_HEIGHT;
      rule(doc, y);
    });
    y += 33;
  };
  table("Mért paraméterek", input.rows, "Paraméter");
  if (input.icp) table(input.icp.title, input.icp.rows, "Elem");

  if (input.notes) {
    const height = measure(
      doc,
      input.notes,
      { size: 9, color: BODY },
      CONTENT_WIDTH,
    );
    ensure(headingHeight + Math.min(height, 60));
    y = heading(doc, "Javasolt intézkedések", y);
    write(doc, input.notes, LEFT, y, { size: 9, color: BODY }, CONTENT_WIDTH);
    y += height + 30;
  }

  if (input.recommendation?.length) {
    // the names stand in the text; the links follow, one product a line
    const text = input.recommendation
      .map((part) =>
        part.kind === "text" ? part.text : (part.name ?? "ismeretlen termék"),
      )
      .join("");
    const height = measure(doc, text, { size: 9, color: BODY }, CONTENT_WIDTH);
    ensure(headingHeight + Math.min(height, 60));
    y = heading(doc, "Ajánlott termékek", y);
    write(doc, text, LEFT, y, { size: 9, color: BODY }, CONTENT_WIDTH);
    y += height + 10;
    const linked = new Map<string, { name: string; url: string }>();
    for (const part of input.recommendation)
      if (part.kind === "product" && part.name && part.url)
        linked.set(part.productId, { name: part.name, url: part.url });
    for (const product of linked.values()) {
      ensure(16);
      doc
        .font(PDF_REGULAR_FONT)
        .fontSize(9)
        .fillColor(TEAL)
        .text(`• ${product.name}`, LEFT, y, {
          width: CONTENT_WIDTH,
          link: product.url,
          underline: true,
        });
      y += 16;
    }
    y += 20;
  }

  ensure(14);
  drawLegend(doc, y);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.rect(0, 0, A4_WIDTH, 9).fillColor(NAVY).fill();
    if (i > 0)
      write(
        doc,
        reportTitle(input),
        LEFT,
        30,
        { size: 11, color: NAVY, bold: true },
        CONTENT_WIDTH,
      );
    drawFooter(doc, i + 1, range.count);
  }
  doc.end();
  return done;
}

interface Style {
  size: number;
  color: string;
  bold?: boolean;
  font?: string;
}

function write(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  style: Style,
  width: number,
  align: "left" | "right" = "left",
) {
  doc
    .font(style.font ?? (style.bold ? PDF_BOLD_FONT : PDF_REGULAR_FONT))
    .fontSize(style.size)
    .fillColor(style.color)
    .text(text, x, y, { width, align, lineGap: 2 });
}

function measure(
  doc: PDFKit.PDFDocument,
  text: string,
  style: Style,
  width: number,
) {
  doc.font(style.bold ? PDF_BOLD_FONT : PDF_REGULAR_FONT).fontSize(style.size);
  return doc.heightOfString(text, { width, lineGap: 2 });
}

function rule(doc: PDFKit.PDFDocument, y: number) {
  doc
    .moveTo(LEFT, y)
    .lineTo(RIGHT_EDGE, y)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
}

const headingHeight = 29;

/** A teal heading over a rule (Figma: the title at y, the rule 19 below). */
function heading(doc: PDFKit.PDFDocument, title: string, y: number): number {
  write(
    doc,
    title.toUpperCase(),
    LEFT,
    y,
    { size: 10, color: TEAL, bold: true },
    CONTENT_WIDTH,
  );
  rule(doc, y + 19);
  return y + headingHeight;
}

/** Without an ICP report the title does not promise one. */
export function reportTitle(
  input: Pick<MeasurementReportPdfInput, "icp">,
): string {
  return input.icp ? "MÉRÉSI EREDMÉNYEK ÉS ICP ELEMZÉS" : "MÉRÉSI EREDMÉNYEK";
}

/**
 * The badge counts deviations, so it needs something to deviate from: when no
 * row has a target range (a freshwater aquarium without its own targets, D5),
 * it is left out rather than saying "no deviation".
 */
export function reportBadge(input: MeasurementReportPdfInput): string | null {
  const marked = [...input.rows, ...(input.icp?.rows ?? [])].some(
    (row) => row.status !== null,
  );
  if (!marked) return null;
  return input.deviations > 0 ? `${input.deviations} ELTÉRÉS` : "NINCS ELTÉRÉS";
}

function drawHeader(
  doc: PDFKit.PDFDocument,
  input: MeasurementReportPdfInput,
): number {
  drawAcroporaLogo(doc, LEFT, 40, 76);
  write(
    doc,
    reportTitle(input),
    132,
    43,
    { size: 18, color: NAVY, bold: true },
    RIGHT_EDGE - 132,
  );
  write(
    doc,
    "TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS",
    132,
    68,
    { size: 8, color: MUTED },
    RIGHT_EDGE - 132,
  );
  rule(doc, 94);
  const badge = reportBadge(input);
  if (!badge) return 146;
  doc
    .roundedRect(RIGHT_EDGE - 111, 105, 110, 21, 3)
    .fillColor(BOX)
    .fill();
  write(
    doc,
    badge,
    RIGHT_EDGE - 104,
    109,
    { size: 9, color: NAVY, bold: true },
    100,
  );
  return 146;
}

/**
 * THE DEVIATION CELL: the mark in DejaVu (✓ inside, ↓ low, ↑ high), then the
 * words in Noto ("rendben", "alacsony", "magas", and the trend).
 */
function drawDeviation(
  doc: PDFKit.PDFDocument,
  row: ReportRow,
  x: number,
  y: number,
  style: Style,
) {
  if (!row.status) {
    write(doc, "–", x, y, style, COLUMN_WIDTHS[4]);
    return;
  }
  const mark = row.status === "OK" ? "✓" : row.direction === "LOW" ? "↓" : "↑";
  const word =
    row.status === "OK"
      ? "rendben"
      : row.direction === "LOW"
        ? "alacsony"
        : "magas";
  const text = row.trend ? `${word} · ${TREND_WORD[row.trend]}` : word;
  doc.font(PDF_BODY_FONT).fontSize(style.size);
  const markWidth = doc.widthOfString(mark) + 3;
  write(doc, mark, x, y, { ...style, font: PDF_BODY_FONT }, markWidth + 2);
  write(doc, text, x + markWidth, y, style, COLUMN_WIDTHS[4] - markWidth);
}

/** "Jelölések: ✓ megfelelő · ! figyelmeztetés · × beavatkozást igényel" */
function drawLegend(doc: PDFKit.PDFDocument, y: number) {
  const parts: Array<[string, Style]> = [
    ["Jelölések:", { size: 8, color: MUTED }],
    ["✓", { size: 8, color: BODY, font: PDF_BODY_FONT }],
    ["megfelelő", { size: 8, color: BODY }],
    ["·", { size: 8, color: MUTED }],
    ["! figyelmeztetés", { size: 8, color: WARN }],
    ["·", { size: 8, color: MUTED }],
    ["× beavatkozást igényel", { size: 8, color: ALERT }],
  ];
  let x = LEFT;
  for (const [text, style] of parts) {
    doc.font(style.font ?? PDF_REGULAR_FONT).fontSize(style.size);
    const width = doc.widthOfString(text);
    write(doc, text, x, y, style, width + 2);
    x += width + (text === "✓" ? 3 : 7);
  }
}

function drawFooter(doc: PDFKit.PDFDocument, page: number, pages: number) {
  const c = ACROPORA_COMPANY;
  rule(doc, FOOTER_RULE);
  write(
    doc,
    `${c.name} · TENGERI AKVÁRIUMOK · TERVEZÉS · KIVITELEZÉS`,
    LEFT,
    FOOTER_RULE + 7,
    { size: 7.1, color: MUTED },
    440,
  );
  write(
    doc,
    `${c.address} · ${c.phone} · ${c.web} · ${c.email}`,
    LEFT,
    FOOTER_RULE + 20,
    { size: 7, color: MUTED },
    440,
  );
  write(
    doc,
    `${page} / ${pages}`,
    RIGHT_EDGE - 50,
    FOOTER_RULE + 8,
    { size: 8, color: NAVY, bold: true },
    50,
    "right",
  );
}
