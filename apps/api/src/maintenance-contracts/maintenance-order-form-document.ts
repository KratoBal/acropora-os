import { Prisma } from "@acropora/database";
import PDFDocument from "pdfkit";

import { registerEmbeddedPdfFont } from "../documents/pdf/branded-document.js";

import {
  computeMaintenanceOrderFormItemAmounts,
  type MaintenanceOrderFormDecimalInput,
} from "./maintenance-order-form-amounts.js";
import { maintenanceOrderFormFieldLines } from "./maintenance-order-form-content.js";
import { formatOrderFormTableAmount } from "./maintenance-order-form-formatting.js";
import type { MaintenanceOrderFormInput } from "./maintenance-order-form.types.js";

/**
 * A MEGRENDELŐLAP PDF-JE -- AZ ÜGYFÉL SAJÁT ŰRLAPJÁNAK ALAKJÁBAN.
 *
 * === MIÉRT NEM A `branded-document.ts` FEJLÉCE/LÁBLÉCE ===
 *
 * A `drawDocumentHeader`/`drawDocumentFooter` a MI arculatunk (logó, "Acropora
 * Kft." lábléc) -- azt a hibajegy- és munkalap-PDF-ek használják, amiket MI
 * adunk ki a saját nevünkben. Ez a lap fordítva áll: az ÜGYFÉL saját belső
 * megrendelőlapjának másolata (`exchange/minta-megrendelolap-allatkert.docx`),
 * amit AZ Ő szervezetükön belül írnak alá (pénzügyi ellenjegyző,
 * kötelezettségvállaló) -- a mi logónknak itt nincs helye.
 *
 * Amit MÉGIS használunk a közös PDF-keretből: a `registerEmbeddedPdfFont`
 * betű-regisztrálás. Ez nem arculat, hanem a magyar ékezetek (`ő`, `ű`)
 * NÉMA elromlásának egyetlen ismert ellenszere (lásd `pdf-font.ts`) -- ezt
 * újraírni ugyanazt a hibát kockáztatná, amit az az egész fájl kizár.
 *
 * === MIÉRT SAJÁT OLDAL-KONSTANSOK ===
 *
 * A `branded-document.ts` margói és tartalom-szélessége A MI FEJLÉCÜNKHÖZ
 * illeszkednek (pl. `PDF_FIRST_CONTENT_TOP` a logó alatti sávot méri). Ennek a
 * lapnak nincs ilyen sávja, ezért saját, egyszerűbb margókkal dolgozik --
 * szándékosan NEM oszt semmit a hibajegy-rajzolóval, hogy a két lap egymástól
 * függetlenül változhasson (lásd a feladat kikötését: a közös keretet ez a
 * kör nem refaktorálja).
 */

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = A4_HEIGHT - MARGIN;
const INK = "#1a1a1a";
const RULE = "#8a8a8a";

const TABLE_COLUMNS: {
  key:
    | "position"
    | "description"
    | "unitPrice"
    | "quantity"
    | "occasions"
    | "total";
  header: string;
  width: number;
  align: "left" | "right" | "center";
}[] = [
  { key: "position", header: "Tétel", width: 26, align: "center" },
  { key: "description", header: "Berendezés", width: 231, align: "left" },
  {
    key: "unitPrice",
    header: "Egységár 1db/alkalom",
    width: 82,
    align: "right",
  },
  { key: "quantity", header: "db", width: 26, align: "center" },
  { key: "occasions", header: "alk/év", width: 40, align: "center" },
  { key: "total", header: "díj összesen", width: 90, align: "right" },
];

interface TableRow {
  position: string;
  description: string;
  unitPrice: string;
  quantity: string;
  occasions: string;
  total: string;
}

function itemToRow(input: {
  position: number;
  description: string;
  unitPricePerOccasion: MaintenanceOrderFormDecimalInput;
  quantity: MaintenanceOrderFormDecimalInput;
  occasionsPerYear: number;
  vatRatePercent: MaintenanceOrderFormDecimalInput;
}): TableRow {
  const amounts = computeMaintenanceOrderFormItemAmounts(input);
  return {
    position: String(input.position),
    description: input.description,
    // A KIÍRT EGYSÉGÁR A BEMENETBŐL JÖN, NEM A NETTÓBÓL VISSZAOSZTVA: a
    // nettó már kerekített (`money()`), tehát egy visszaosztás felesleges
    // kerekítési eltérést vinne a lapra egy olyan mezőn, aminek a bemenet
    // maga a forrása.
    unitPrice: formatOrderFormTableAmount(
      new Prisma.Decimal(input.unitPricePerOccasion),
    ),
    quantity: String(input.quantity),
    occasions: String(input.occasionsPerYear),
    total: formatOrderFormTableAmount(amounts.netAmount),
  };
}

function drawTableRow(
  document: PDFKit.PDFDocument,
  row: TableRow,
  y: number,
  options: { header?: boolean; fontSize: number; rowHeight: number },
): void {
  let x = MARGIN;
  document.fillColor(INK).fontSize(options.fontSize);
  for (const column of TABLE_COLUMNS) {
    const text = options.header ? column.header : row[column.key];
    document.text(text, x + 3, y + 4, {
      width: column.width - 6,
      align: column.align,
    });
    x += column.width;
  }
  document
    .rect(MARGIN, y, CONTENT_WIDTH, options.rowHeight)
    .strokeColor(RULE)
    .lineWidth(0.5)
    .stroke();
  x = MARGIN;
  for (const column of TABLE_COLUMNS.slice(0, -1)) {
    x += column.width;
    document
      .moveTo(x, y)
      .lineTo(x, y + options.rowHeight)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
  }
}

function rowHeight(
  document: PDFKit.PDFDocument,
  row: TableRow,
  header: boolean,
  fontSize: number,
): number {
  document.fontSize(fontSize);
  const heights = TABLE_COLUMNS.map((column) =>
    document.heightOfString(header ? column.header : row[column.key], {
      width: column.width - 6,
    }),
  );
  return Math.max(...heights) + 8;
}

/**
 * A MEGRENDELŐLAP BEMENETÉBŐL PDF-BÁJTOK -- TISZTA FÜGGVÉNY.
 *
 * Nem ír adatbázisba, nem tölt fel semmit, és nem tud a `Contract`/
 * `ContractItem` modellről: a bekötés egy KÉSŐBBI kör feladata, amikor a
 * szerződés-adatmodell megvan.
 */
export function renderMaintenanceOrderFormPdf(
  input: MaintenanceOrderFormInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let document: PDFKit.PDFDocument;
    try {
      document = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
      registerEmbeddedPdfFont(document);
    } catch (error) {
      reject(error);
      return;
    }
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const { header, footer } = maintenanceOrderFormFieldLines(input);
      let y = MARGIN;

      const need = (height: number) => {
        if (y + height > CONTENT_BOTTOM) {
          document.addPage({ size: "A4", margin: 0 });
          y = MARGIN;
        }
      };

      const drawLine = (line: string, fontSize: number, bold = false) => {
        document.fillColor(INK).fontSize(fontSize);
        const height = document.heightOfString(line, {
          width: CONTENT_WIDTH,
        });
        need(height + 6);
        document.text(line, MARGIN, y, { width: CONTENT_WIDTH });
        y += height + (bold ? 8 : 4);
      };

      drawLine(header[0]!, 14, true);
      for (const line of header.slice(1)) drawLine(line, 9.5);

      y += 8;
      const tableFontSize = 8;
      const headerHeight = rowHeight(
        document,
        {} as TableRow,
        true,
        tableFontSize,
      );
      need(headerHeight);
      drawTableRow(document, {} as TableRow, y, {
        header: true,
        fontSize: tableFontSize,
        rowHeight: headerHeight,
      });
      y += headerHeight;

      for (const item of input.items) {
        const row = itemToRow(item);
        const height = rowHeight(document, row, false, tableFontSize);
        need(height);
        drawTableRow(document, row, y, {
          fontSize: tableFontSize,
          rowHeight: height,
        });
        y += height;
      }

      y += 12;
      for (const line of footer) drawLine(line, 9.5);

      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
