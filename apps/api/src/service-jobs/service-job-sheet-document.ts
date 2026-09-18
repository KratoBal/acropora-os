import { statSync } from "node:fs";

import PDFDocument from "pdfkit";

import { drawAcroporaLogo } from "../documents/pdf/acropora-logo.js";
import { resolvePdfFontPath } from "../documents/pdf/pdf-font.js";

import {
  serviceJobSheetSections,
  serviceJobSheetSummary,
  type ServiceJobSheetInput,
} from "./service-job-sheet-content.js";

const PAGE_WIDTH = 595.28;
const LEFT = 54;
const RIGHT = 54;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const FIRST_PAGE_TOP = 194;
const CONTINUATION_TOP = 76;
const CONTENT_BOTTOM = 760;
const INK = "#18353d";
const MUTED = "#56777e";
const RULE = "#c9dadd";
const PALE = "#f2f7f7";
const STATUS = "#1e604c";

function assertFont(path: string): void {
  if (!statSync(path).isFile())
    throw new Error("The PDF font must be an embeddable font file.");
}

function drawHeader(
  document: PDFKit.PDFDocument,
  input: ServiceJobSheetInput,
): void {
  document
    .fillColor(MUTED)
    .fontSize(8.5)
    .text("ELKÉSZÜLT HIBAJEGY", LEFT, 64, { characterSpacing: 1.8 });
  document
    .fillColor(INK)
    .fontSize(22)
    .text(input.title, LEFT, 86, { width: 305, lineGap: 2 });
  document
    .fillColor(MUTED)
    .fontSize(10)
    .text(
      `${input.jobNumber} · kiállítva: ${new Intl.DateTimeFormat("hu-HU", { dateStyle: "long", timeZone: "Europe/Budapest" }).format(input.closedAt)}`,
      LEFT,
      136,
      { width: 310 },
    );
  drawAcroporaLogo(document, 440, 64, 76);
  document
    .moveTo(0, 170)
    .lineTo(PAGE_WIDTH, 170)
    .strokeColor(RULE)
    .lineWidth(1)
    .stroke();
}

function drawFooter(document: PDFKit.PDFDocument): void {
  document
    .moveTo(LEFT, 774)
    .lineTo(PAGE_WIDTH - RIGHT, 774)
    .strokeColor(RULE)
    .lineWidth(0.75)
    .stroke();
  document
    .fillColor(MUTED)
    .fontSize(7.2)
    .text(
      "Acropora Kft. · 1106 Budapest, Pesti Gábor utca 35 · info@acropora.hu · hibabejelentés: ticket@acropora.hu · +36-30-982-3634",
      LEFT,
      786,
      { width: CONTENT_WIDTH, align: "center" },
    );
}

function drawSectionTitle(
  document: PDFKit.PDFDocument,
  title: string,
  y: number,
): number {
  document.fillColor(INK).fontSize(12).text(title, LEFT, y);
  return y + 22;
}

/** Build the closed service job document. Kept separate so a later seal can wrap these exact bytes. */
export function serviceJobSheetDocument(
  input: ServiceJobSheetInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({
      size: "A4",
      margin: 0,
      bufferPages: true,
    });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const font = resolvePdfFontPath();
      assertFont(font);
      document.registerFont("acropora", font);
      document.font("acropora");

      const summary = serviceJobSheetSummary(input);
      document
        .rect(LEFT, FIRST_PAGE_TOP, CONTENT_WIDTH, 38)
        .fill("#ffffff")
        .strokeColor("#b9d9cb")
        .lineWidth(1)
        .stroke();
      document
        .fillColor(STATUS)
        .fontSize(10)
        .text(summary.status, LEFT + 16, FIRST_PAGE_TOP + 13);
      document
        .fillColor("#48705f")
        .fontSize(9.5)
        .text(summary.closedAt, LEFT + 255, FIRST_PAGE_TOP + 13, {
          width: CONTENT_WIDTH - 271,
          align: "right",
        });

      const cards = [
        ["PARTNER", summary.customer],
        ["HELYSZÍN", summary.department],
        ["MEGNYITVA", summary.openedAt],
        ["ELKÉSZÜLT", summary.closedAt],
      ] as const;
      const cardTop = FIRST_PAGE_TOP + 38;
      const cardHeight = 62;
      cards.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = LEFT + column * (CONTENT_WIDTH / 2);
        const y = cardTop + row * cardHeight;
        document
          .rect(x, y, CONTENT_WIDTH / 2, cardHeight)
          .fill(PALE)
          .strokeColor(RULE)
          .lineWidth(0.75)
          .stroke();
        document
          .fillColor(MUTED)
          .fontSize(7.5)
          .text(label, x + 14, y + 13, { characterSpacing: 1.35 });
        document
          .fillColor(INK)
          .fontSize(10.3)
          .text(value, x + 14, y + 30, {
            width: CONTENT_WIDTH / 2 - 28,
            height: 24,
            ellipsis: true,
          });
      });

      let y = cardTop + cardHeight * 2 + 34;
      const newPage = () => {
        document.addPage({ size: "A4", margin: 0 });
        y = CONTINUATION_TOP;
      };
      const need = (height: number) => {
        if (y + height > CONTENT_BOTTOM) newPage();
      };

      for (const section of serviceJobSheetSections(input)) {
        const lines = section.lines;
        const estimated =
          30 +
          lines.reduce((total, line) => {
            document.fontSize(10);
            return (
              total +
              document.heightOfString(line, { width: CONTENT_WIDTH }) +
              8
            );
          }, 0);
        need(Math.min(estimated, 200));
        y = drawSectionTitle(document, section.title, y);
        for (const line of lines) {
          document.fillColor(INK).fontSize(10);
          const height = document.heightOfString(line, {
            width: CONTENT_WIDTH - 16,
            lineGap: 2,
          });
          need(height + 10);
          document
            .fillColor(MUTED)
            .fontSize(10)
            .text("•", LEFT, y, { width: 10 });
          document
            .fillColor(INK)
            .fontSize(10)
            .text(line, LEFT + 16, y, {
              width: CONTENT_WIDTH - 16,
              lineGap: 2,
            });
          y += height + 8;
        }
        y += 17;
      }

      const range = document.bufferedPageRange();
      for (
        let page = range.start;
        page < range.start + range.count;
        page += 1
      ) {
        document.switchToPage(page);
        drawHeader(document, input);
        drawFooter(document);
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
