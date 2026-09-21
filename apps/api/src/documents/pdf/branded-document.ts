import { statSync } from "node:fs";

import PDFDocument from "pdfkit";

import { drawAcroporaLogo } from "./acropora-logo.js";
import { resolvePdfFontPath } from "./pdf-font.js";

export const PDF_BODY_FONT = "acropora";
export const A4_WIDTH = 595.28;
export const PDF_LEFT = 54;
export const PDF_RIGHT = 54;
export const PDF_CONTENT_WIDTH = A4_WIDTH - PDF_LEFT - PDF_RIGHT;
export const PDF_CONTENT_BOTTOM = 760;
export const PDF_FIRST_CONTENT_TOP = 194;
export const PDF_CONTINUATION_CONTENT_TOP = 92;
export const PDF_INK = "#18353d";
export const PDF_MUTED = "#56777e";
export const PDF_RULE = "#c9dadd";

export function createBrandedPdf(
  options: { fontPath?: string } = {},
): PDFKit.PDFDocument {
  const document = new PDFDocument({
    size: "A4",
    margin: 0,
    bufferPages: true,
  });
  return registerEmbeddedPdfFont(document, options.fontPath);
}

/** Registers the sole embedded body font for every Acropora PDF renderer. */
export function registerEmbeddedPdfFont(
  document: PDFKit.PDFDocument,
  requestedPath?: string,
): PDFKit.PDFDocument {
  const fontPath = requestedPath ?? resolvePdfFontPath();
  if (!statSync(fontPath).isFile())
    throw new Error("The PDF font must be an embeddable font file.");
  document.registerFont(PDF_BODY_FONT, fontPath);
  return document.font(PDF_BODY_FONT);
}

export function drawDocumentFooter(document: PDFKit.PDFDocument): void {
  document
    .moveTo(PDF_LEFT, 774)
    .lineTo(A4_WIDTH - PDF_RIGHT, 774)
    .strokeColor(PDF_RULE)
    .lineWidth(0.75)
    .stroke();
  document
    .fillColor(PDF_MUTED)
    .fontSize(7.2)
    .text(
      "Acropora Kft. · 1106 Budapest, Pesti Gábor utca 35 · info@acropora.hu · hibabejelentés: ticket@acropora.hu · +36-30-982-3634",
      PDF_LEFT,
      786,
      { width: PDF_CONTENT_WIDTH, align: "center" },
    );
}

export function drawDocumentHeader(
  document: PDFKit.PDFDocument,
  input: {
    eyebrow: string;
    title: string;
    subtitle: string;
    compact?: boolean;
  },
): void {
  if (input.compact) {
    document
      .fillColor(PDF_MUTED)
      .fontSize(8.5)
      .text(input.subtitle, PDF_LEFT, 54, {
        width: PDF_CONTENT_WIDTH,
        align: "right",
      });
    document
      .moveTo(PDF_LEFT, 76)
      .lineTo(A4_WIDTH - PDF_RIGHT, 76)
      .strokeColor(PDF_RULE)
      .lineWidth(0.75)
      .stroke();
    return;
  }
  document
    .fillColor(PDF_MUTED)
    .fontSize(8.5)
    .text(input.eyebrow, PDF_LEFT, 64, {
      characterSpacing: 1.8,
    });
  document.fillColor(PDF_INK).fontSize(22).text(input.title, PDF_LEFT, 86, {
    width: 305,
    lineGap: 2,
  });
  document
    .fillColor(PDF_MUTED)
    .fontSize(10)
    .text(input.subtitle, PDF_LEFT, 136, {
      width: 310,
    });
  drawAcroporaLogo(document, 440, 64, 76);
  document
    .moveTo(0, 170)
    .lineTo(A4_WIDTH, 170)
    .strokeColor(PDF_RULE)
    .lineWidth(1)
    .stroke();
}

export function drawSectionTitle(
  document: PDFKit.PDFDocument,
  title: string,
  y: number,
): number {
  document.fillColor(PDF_INK).fontSize(12).text(title, PDF_LEFT, y);
  return y + 22;
}

export function addPage(document: PDFKit.PDFDocument): void {
  document.addPage({ size: "A4", margin: 0 });
}
