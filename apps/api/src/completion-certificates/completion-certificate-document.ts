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

import {
  completionCertificateContent,
  type CompletionCertificateLine,
} from "./completion-certificate-content.js";
import type { CompletionCertificateInput } from "./completion-certificate-types.js";

/**
 * A TÁBLA OSZLOPAI, UGYANARRA A SZÉLESSÉGRE, MINT A KÖZÖS KERET
 * (`PDF_CONTENT_WIDTH`). A minta (ÁLT #2026-12) arányait követi: a
 * megnevezés a legszélesebb, az ÁFA a legkeskenyebb.
 */
const COL_DESCRIPTION = 220;
const COL_QUANTITY = 70;
const COL_UNIT_PRICE = 70;
const COL_VAT = 50;
const COL_NET =
  PDF_CONTENT_WIDTH - COL_DESCRIPTION - COL_QUANTITY - COL_UNIT_PRICE - COL_VAT;

const TABLE_HEAD = "#2a4a52";
const TABLE_HEAD_TEXT = "#ffffff";
const TOTALS_RULE = "#c9dadd";
const TOTALS_GROSS_BG = "#2a4a52";
const TOTALS_GROSS_TEXT = "#ffffff";

/**
 * A TELJESÍTÉSI IGAZOLÁS PDF-JE, A KÖZÖS KERETBEN.
 *
 * UGYANAZT A KERETET (`branded-document.ts`) HASZNÁLJA, MINT AZ ELKÉSZÜLT
 * HIBAJEGY LAPJA (`service-job-sheet-document.ts`) -- nem másolja azt, csak
 * hívja. A fejléc/lábléc rajzolása, a betű-regisztráció, az A4 méret és a
 * margók mind onnan jönnek.
 *
 * A MINTA (`exchange/minta-teljesitesi-igazolas-allatkert.pdf`, "ÁLT
 * #2026-12") a KÖZÖS KERETNÉL RÉSZLETESEBB fejlécet mutat (Teljesítésigazolás
 * / Tárgy / Ügyfél, három oszlopban) -- azt a kereten BELÜLI TARTALOMKÉNT
 * rajzoljuk (a `drawDocumentHeader` eyebrow/title/subtitle hármasába nem fér
 * bele mindhárom), nem a közös fejléc cseréjeként.
 */
export function completionCertificateDocument(
  input: CompletionCertificateInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf();
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const content = completionCertificateContent(input);

      let y = PDF_FIRST_CONTENT_TOP;
      const newPage = () => {
        addPage(document);
        y = PDF_CONTINUATION_CONTENT_TOP;
      };
      const need = (height: number) => {
        if (y + height > PDF_CONTENT_BOTTOM) newPage();
      };

      // TÁRGY (bal) ÉS ÜGYFÉL (jobb), KÉT OSZLOPBAN.
      const leftWidth = PDF_CONTENT_WIDTH * 0.55 - 12;
      const rightX = PDF_LEFT + PDF_CONTENT_WIDTH * 0.55 + 12;
      const rightWidth = PDF_CONTENT_WIDTH * 0.45 - 12;

      document
        .fillColor(PDF_MUTED)
        .fontSize(8)
        .text("TÁRGY", PDF_LEFT, y, { characterSpacing: 1.2 });
      document
        .fillColor(PDF_INK)
        .fontSize(10.5)
        .text(content.subject, PDF_LEFT, y + 14, {
          width: leftWidth,
          lineGap: 2,
        });
      let subjectY =
        y +
        14 +
        document.heightOfString(content.subject, {
          width: leftWidth,
          lineGap: 2,
        });
      if (content.worksheetReference) {
        document
          .fillColor(PDF_MUTED)
          .fontSize(9)
          .text(content.worksheetReference, PDF_LEFT, subjectY + 3, {
            width: leftWidth,
          });
        subjectY +=
          3 +
          document.heightOfString(content.worksheetReference, {
            width: leftWidth,
          });
      }

      document.fillColor(PDF_MUTED).fontSize(8).text("ÜGYFÉL", rightX, y, {
        width: rightWidth,
        align: "right",
        characterSpacing: 1.2,
      });
      let customerY = y + 14;
      document
        .fillColor(PDF_INK)
        .fontSize(10.5)
        .text(content.customerName, rightX, customerY, {
          width: rightWidth,
          align: "right",
        });
      customerY += document.heightOfString(content.customerName, {
        width: rightWidth,
        align: "right",
      });
      const customerDetailLines = [
        ...content.customerAddressLines,
        ...(content.customerTaxNumber ? [content.customerTaxNumber] : []),
        ...(content.customerContactLine ? [content.customerContactLine] : []),
      ];
      for (const line of customerDetailLines) {
        document
          .fillColor(PDF_MUTED)
          .fontSize(9)
          .text(line, rightX, customerY + 3, {
            width: rightWidth,
            align: "right",
          });
        customerY +=
          3 +
          document.heightOfString(line, {
            width: rightWidth,
            align: "right",
          });
      }

      y = Math.max(subjectY, customerY) + 22;

      // A TÁBLA FEJLÉCE.
      need(28);
      const headHeight = 24;
      document
        .rect(PDF_LEFT, y, PDF_CONTENT_WIDTH, headHeight)
        .fill(TABLE_HEAD);
      const headY = y + 8;
      document.fillColor(TABLE_HEAD_TEXT).fontSize(8.5);
      let colX = PDF_LEFT + 10;
      document.text("MEGNEVEZÉS", colX, headY);
      colX = PDF_LEFT + COL_DESCRIPTION;
      document.text("MENNYISÉG", colX, headY, {
        width: COL_QUANTITY,
        align: "right",
      });
      colX += COL_QUANTITY;
      document.text("EGYSÉGÁR", colX, headY, {
        width: COL_UNIT_PRICE,
        align: "right",
      });
      colX += COL_UNIT_PRICE;
      document.text("ÁFA", colX, headY, { width: COL_VAT, align: "right" });
      colX += COL_VAT;
      document.text("NETTÓ ÖSSZ.", colX, headY, {
        width: COL_NET - 10,
        align: "right",
      });
      y += headHeight;

      // A TÉTELSOROK.
      for (const line of content.lines) {
        const rowHeight = estimateRowHeight(
          document,
          line,
          COL_DESCRIPTION - 10,
        );
        need(rowHeight);
        drawItemRow(document, line, y, rowHeight);
        y += rowHeight;
      }

      y += 18;

      // AZ ÖSSZESÍTŐ, JOBBRA IGAZÍTVA.
      need(70);
      const totalsLabelWidth = 160;
      const totalsValueWidth = 130;
      const totalsX =
        PDF_LEFT + PDF_CONTENT_WIDTH - totalsLabelWidth - totalsValueWidth;
      const totalsRows: [string, string, boolean][] = [
        ["Nettó összesen:", content.totals.netLabel, false],
        ["ÁFA összesen:", content.totals.vatLabel, false],
        ["Bruttó összesen:", content.totals.grossLabel, true],
      ];
      for (const [label, value, isGross] of totalsRows) {
        const rowH = 22;
        if (isGross) {
          document
            .rect(totalsX, y, totalsLabelWidth + totalsValueWidth, rowH)
            .fill(TOTALS_GROSS_BG);
        } else {
          document
            .moveTo(totalsX, y)
            .lineTo(totalsX + totalsLabelWidth + totalsValueWidth, y)
            .strokeColor(TOTALS_RULE)
            .lineWidth(0.5)
            .stroke();
        }
        const textColor = isGross ? TOTALS_GROSS_TEXT : PDF_INK;
        document
          .fillColor(textColor)
          .fontSize(9.5)
          .text(label, totalsX + 10, y + 6, {
            width: totalsLabelWidth - 10,
            align: "left",
          });
        document
          .fillColor(textColor)
          .fontSize(9.5)
          .text(value, totalsX + totalsLabelWidth, y + 6, {
            width: totalsValueWidth - 10,
            align: "right",
          });
        y += rowH;
      }

      // AZ ALÁÍRÓ -- CSAK HA MEGADTÁK.
      if (content.signerName || content.signerEmail) {
        y += 24;
        need(30);
        if (content.signerName) {
          document
            .fillColor(PDF_INK)
            .fontSize(9.5)
            .text(content.signerName, PDF_LEFT, y);
          y += document.heightOfString(content.signerName) + 2;
        }
        if (content.signerEmail) {
          document
            .fillColor(PDF_MUTED)
            .fontSize(9)
            .text(content.signerEmail, PDF_LEFT, y);
        }
      }

      const range = document.bufferedPageRange();
      for (
        let page = range.start;
        page < range.start + range.count;
        page += 1
      ) {
        document.switchToPage(page);
        drawDocumentHeader(document, {
          eyebrow: "TELJESÍTÉSIGAZOLÁS",
          title: content.certificateNumber,
          subtitle: `Keltezés: ${content.issuedAtLabel} · Teljesítés: ${content.completedAtLabel}`,
          compact: page !== range.start,
        });
        drawDocumentFooter(document);
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}

function estimateRowHeight(
  document: PDFKit.PDFDocument,
  line: CompletionCertificateLine,
  descriptionWidth: number,
): number {
  document.fontSize(10);
  let height =
    18 +
    document.heightOfString(line.description, {
      width: descriptionWidth,
    });
  if (line.detail)
    height += document.heightOfString(line.detail, { width: descriptionWidth });
  if (line.contractNumber)
    height += document.heightOfString(`Szerződésszám: ${line.contractNumber}`, {
      width: descriptionWidth,
    });
  return Math.max(height, 30);
}

function drawItemRow(
  document: PDFKit.PDFDocument,
  line: CompletionCertificateLine,
  y: number,
  rowHeight: number,
): void {
  document
    .moveTo(PDF_LEFT, y)
    .lineTo(PDF_LEFT + PDF_CONTENT_WIDTH, y)
    .strokeColor(PDF_RULE)
    .lineWidth(0.5)
    .stroke();
  document
    .moveTo(PDF_LEFT, y + rowHeight)
    .lineTo(PDF_LEFT + PDF_CONTENT_WIDTH, y + rowHeight)
    .strokeColor(PDF_RULE)
    .lineWidth(0.5)
    .stroke();

  const descriptionWidth = COL_DESCRIPTION - 10;
  let textY = y + 9;
  document
    .fillColor(PDF_INK)
    .fontSize(10)
    .text(line.description, PDF_LEFT + 10, textY, {
      width: descriptionWidth,
    });
  textY += document.heightOfString(line.description, {
    width: descriptionWidth,
  });
  if (line.detail) {
    document
      .fillColor(PDF_MUTED)
      .fontSize(8.5)
      .text(line.detail, PDF_LEFT + 10, textY, { width: descriptionWidth });
    textY += document.heightOfString(line.detail, { width: descriptionWidth });
  }
  if (line.contractNumber) {
    document
      .fillColor(PDF_MUTED)
      .fontSize(8.5)
      .text(`Szerződésszám: ${line.contractNumber}`, PDF_LEFT + 10, textY, {
        width: descriptionWidth,
      });
  }

  const valueY = y + 9;
  let colX = PDF_LEFT + COL_DESCRIPTION;
  document
    .fillColor(PDF_INK)
    .fontSize(10)
    .text(line.quantityLabel, colX, valueY, {
      width: COL_QUANTITY,
      align: "right",
    });
  colX += COL_QUANTITY;
  document.text(line.unitPriceLabel, colX, valueY, {
    width: COL_UNIT_PRICE,
    align: "right",
  });
  colX += COL_UNIT_PRICE;
  document.text(line.vatRateLabel, colX, valueY, {
    width: COL_VAT,
    align: "right",
  });
  colX += COL_VAT;
  document.text(line.netLabel, colX, valueY, {
    width: COL_NET - 10,
    align: "right",
  });
}
