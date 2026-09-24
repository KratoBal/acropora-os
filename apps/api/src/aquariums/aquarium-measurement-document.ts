import {
  PDF_CONTENT_BOTTOM,
  PDF_CONTENT_WIDTH,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
  PDF_RULE,
  addPage,
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
} from "../documents/pdf/branded-document.js";

export interface AquariumMeasurementDocumentInput {
  aquariumName: string;
  customerName: string;
  measuredAt: string;
  rows: readonly { label: string; value: number; unit: string }[];
  notes?: string;
}

const COL_LABEL = 280;
const COL_VALUE = PDF_CONTENT_WIDTH - COL_LABEL;
const TABLE_HEAD = "#2a4a52";
const TABLE_HEAD_TEXT = "#ffffff";
const ROW_HEIGHT = 20;

/**
 * A VÍZMÉRÉS PDF-JE, A KÖZÖS KERETBEN.
 *
 * UGYANAZT A KERETET HASZNÁLJA, MINT A TELJESÍTÉSI IGAZOLÁS
 * (`completion-certificate-document.ts`) -- ott indokolt a réteg
 * részletesebben, itt csak hívja. Szándékosan EGYSZERŰBB annál: nincs
 * tétel-ár, ÁFA, összesítés -- egy táblázat (paraméter, érték, egység).
 */
export function aquariumMeasurementDocument(
  input: AquariumMeasurementDocumentInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf();
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      drawDocumentHeader(document, {
        eyebrow: "ACROPORA · VÍZMÉRÉS",
        title: input.aquariumName,
        subtitle: `${input.customerName} · ${new Date(
          input.measuredAt,
        ).toLocaleString("hu-HU")}`,
      });

      let y = PDF_FIRST_CONTENT_TOP;
      const newPage = () => {
        addPage(document);
        drawDocumentHeader(document, {
          eyebrow: "ACROPORA · VÍZMÉRÉS",
          title: input.aquariumName,
          subtitle: `${input.customerName} · ${new Date(
            input.measuredAt,
          ).toLocaleString("hu-HU")}`,
          compact: true,
        });
        y = PDF_CONTINUATION_CONTENT_TOP;
      };

      document
        .rect(PDF_LEFT, y, PDF_CONTENT_WIDTH, ROW_HEIGHT)
        .fill(TABLE_HEAD);
      document
        .fillColor(TABLE_HEAD_TEXT)
        .fontSize(9)
        .text("Paraméter", PDF_LEFT + 8, y + 5, { width: COL_LABEL - 8 })
        .text("Érték", PDF_LEFT + COL_LABEL, y + 5, {
          width: COL_VALUE - 8,
          align: "right",
        });
      y += ROW_HEIGHT;

      for (const row of input.rows) {
        if (y + ROW_HEIGHT > PDF_CONTENT_BOTTOM) newPage();
        document
          .moveTo(PDF_LEFT, y)
          .lineTo(PDF_LEFT + PDF_CONTENT_WIDTH, y)
          .strokeColor(PDF_RULE)
          .lineWidth(0.5)
          .stroke();
        document
          .fillColor(PDF_INK)
          .fontSize(10)
          .text(row.label, PDF_LEFT + 8, y + 5, { width: COL_LABEL - 8 })
          .text(`${row.value} ${row.unit}`, PDF_LEFT + COL_LABEL, y + 5, {
            width: COL_VALUE - 8,
            align: "right",
          });
        y += ROW_HEIGHT;
      }

      if (input.notes) {
        y += 12;
        if (y + 40 > PDF_CONTENT_BOTTOM) newPage();
        document
          .fillColor(PDF_MUTED)
          .fontSize(8)
          .text("MEGJEGYZÉS", PDF_LEFT, y, { characterSpacing: 1.2 });
        document
          .fillColor(PDF_INK)
          .fontSize(10)
          .text(input.notes, PDF_LEFT, y + 14, { width: PDF_CONTENT_WIDTH });
      }

      drawDocumentFooter(document);
      document.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
