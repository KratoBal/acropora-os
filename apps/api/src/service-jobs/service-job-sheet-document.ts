import {
  PDF_CONTENT_BOTTOM,
  PDF_CONTENT_WIDTH,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  addPage,
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
  drawSectionTitle,
} from "../documents/pdf/branded-document.js";

import {
  serviceJobSheetSections,
  serviceJobSheetSummary,
  type ServiceJobSheetInput,
} from "./service-job-sheet-content.js";

const MUTED = "#56777e";
const RULE = "#c9dadd";
const PALE = "#f2f7f7";
const STATUS = "#1e604c";

/** Build the closed service job document. Kept separate so a later seal can wrap these exact bytes. */
export function serviceJobSheetDocument(
  input: ServiceJobSheetInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf();
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const summary = serviceJobSheetSummary(input);
      document
        .rect(PDF_LEFT, PDF_FIRST_CONTENT_TOP, PDF_CONTENT_WIDTH, 38)
        .fill("#ffffff")
        .strokeColor("#b9d9cb")
        .lineWidth(1)
        .stroke();
      document
        .fillColor(STATUS)
        .fontSize(10)
        .text(summary.status, PDF_LEFT + 16, PDF_FIRST_CONTENT_TOP + 13);
      document
        .fillColor("#48705f")
        .fontSize(9.5)
        .text(summary.closedAt, PDF_LEFT + 255, PDF_FIRST_CONTENT_TOP + 13, {
          width: PDF_CONTENT_WIDTH - 271,
          align: "right",
        });

      const cards = [
        ["PARTNER", summary.customer],
        ["HELYSZÍN", summary.department],
        ["MEGNYITVA", summary.openedAt],
        ["ELKÉSZÜLT", summary.closedAt],
      ] as const;
      const cardTop = PDF_FIRST_CONTENT_TOP + 38;
      const cardHeight = 62;
      cards.forEach(([label, value], index) => {
        const column = index % 2;
        const row = Math.floor(index / 2);
        const x = PDF_LEFT + column * (PDF_CONTENT_WIDTH / 2);
        const y = cardTop + row * cardHeight;
        document
          .rect(x, y, PDF_CONTENT_WIDTH / 2, cardHeight)
          .fill(PALE)
          .strokeColor(RULE)
          .lineWidth(0.75)
          .stroke();
        document
          .fillColor(MUTED)
          .fontSize(7.5)
          .text(label, x + 14, y + 13, { characterSpacing: 1.35 });
        document
          .fillColor(PDF_INK)
          .fontSize(10.3)
          .text(value, x + 14, y + 30, {
            width: PDF_CONTENT_WIDTH / 2 - 28,
            height: 24,
            ellipsis: true,
          });
      });

      let y = cardTop + cardHeight * 2 + 34;
      const newPage = () => {
        addPage(document);
        y = PDF_CONTINUATION_CONTENT_TOP;
      };
      const need = (height: number) => {
        if (y + height > PDF_CONTENT_BOTTOM) newPage();
      };

      for (const section of serviceJobSheetSections(input)) {
        const lines = section.lines;
        const estimated =
          30 +
          lines.reduce((total, line) => {
            document.fontSize(10);
            return (
              total +
              document.heightOfString(line, { width: PDF_CONTENT_WIDTH }) +
              8
            );
          }, 0);
        need(Math.min(estimated, 200));
        y = drawSectionTitle(document, section.title, y);
        for (const line of lines) {
          document.fillColor(PDF_INK).fontSize(10);
          const height = document.heightOfString(line, {
            width: PDF_CONTENT_WIDTH - 16,
            lineGap: 2,
          });
          need(height + 10);
          document
            .fillColor(MUTED)
            .fontSize(10)
            .text("•", PDF_LEFT, y, { width: 10 });
          document
            .fillColor(PDF_INK)
            .fontSize(10)
            .text(line, PDF_LEFT + 16, y, {
              width: PDF_CONTENT_WIDTH - 16,
              lineGap: 2,
            });
          y += height + 8;
        }
        y += 17;
      }

      const photos = input.photos ?? [];
      if (photos.length) {
        need(42);
        y = drawSectionTitle(document, "FÉNYKÉPEK", y);
        const columnWidth = (PDF_CONTENT_WIDTH - 12) / 2;
        for (let index = 0; index < photos.length; index += 2) {
          const row = photos.slice(index, index + 2);
          const imageHeight = 116;
          const captions = row.map((photo) => photo.caption?.trim() ?? "");
          const captionHeight = captions.some(Boolean) ? 20 : 0;
          need(imageHeight + captionHeight + 14);
          row.forEach((photo, column) => {
            const x = PDF_LEFT + column * (columnWidth + 12);
            try {
              document.image(Buffer.from(photo.thumbnail), x, y, {
                fit: [columnWidth, imageHeight],
                align: "center",
                valign: "center",
              });
              document
                .rect(x, y, columnWidth, imageHeight)
                .strokeColor(RULE)
                .lineWidth(0.5)
                .stroke();
            } catch {
              // A sérült thumbnail nem teheti kiadhatatlanná a hiteles PDF-et.
            }
            if (captions[column])
              document
                .fillColor(MUTED)
                .fontSize(7.5)
                .text(captions[column]!, x, y + imageHeight + 4, {
                  width: columnWidth,
                });
          });
          y += imageHeight + captionHeight + 14;
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
          eyebrow: "ELKÉSZÜLT HIBAJEGY",
          title: input.title,
          subtitle: `${input.jobNumber} · kiállítva: ${new Intl.DateTimeFormat("hu-HU", { dateStyle: "long", timeZone: "Europe/Budapest" }).format(input.closedAt)}`,
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
