import {
  ACROPORA_COMPANY,
  fillRentalContractTemplate,
  formatMoney,
  RENTAL_CONTRACT_MISSING_VALUE,
  rentalContractBlocks,
  type Rental,
  type RentalContractValues,
  type RentalSettings,
} from "@acropora/types";

import {
  addPage,
  createBrandedPdf,
  drawDocumentFooter,
  drawDocumentHeader,
  PDF_CONTENT_BOTTOM,
  PDF_CONTENT_WIDTH,
  PDF_CONTINUATION_CONTENT_TOP,
  PDF_FIRST_CONTENT_TOP,
  PDF_INK,
  PDF_LEFT,
  PDF_MUTED,
} from "../documents/pdf/branded-document.js";

const BUDAPEST_DATE_TIME = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const BUDAPEST_DAY = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const NUMBER = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 2 });

const huf = (amount: number) => formatMoney(amount, "HUF");
const orDash = (text: string | null) =>
  text && text.trim() !== "" ? text : "nincs";

/**
 * The values of the contract's places, from the rental's own copy of the terms (never from the device's current row: the
 * contract prints what was agreed). Times on the Budapest clock; a setting not decided yet prints as such.
 */
export function rentalContractValues(
  rental: Rental,
  settings: Pick<RentalSettings, "lateFeeMultiplier" | "replacementAfterDays">,
  printedAt: Date,
): RentalContractValues {
  return {
    szerzodes_szam: rental.rentalNumber,
    ceg_nev: ACROPORA_COMPANY.name,
    ceg_szekhely: ACROPORA_COMPANY.address,
    berlo_nev: rental.customer.displayName,
    berlo_cim: orDash(rental.customer.address),
    berlo_telefon: orDash(rental.customer.phone),
    berlo_email: orDash(rental.customer.email),
    eszkoz_nev: rental.equipment.name,
    eszkoz_gyari_szam: orDash(rental.equipment.serialNumber),
    eszkoz_tartozekok: orDash(rental.accessories),
    atadaskori_megjegyzes: orDash(rental.note),
    berles_kezdete: BUDAPEST_DATE_TIME.format(new Date(rental.startsAt)),
    tervezett_visszahozas: BUDAPEST_DATE_TIME.format(
      new Date(rental.plannedReturnAt),
    ),
    napi_dij: huf(rental.dailyFeeHuf),
    varhato_dij: huf(rental.expectedFeeHuf),
    kaucio: huf(rental.depositHuf),
    potlasi_ertek: huf(rental.replacementValueHuf),
    kesedelmi_szorzo:
      settings.lateFeeMultiplier === null
        ? RENTAL_CONTRACT_MISSING_VALUE
        : NUMBER.format(settings.lateFeeMultiplier),
    kesedelem_napok:
      settings.replacementAfterDays === null
        ? RENTAL_CONTRACT_MISSING_VALUE
        : String(settings.replacementAfterDays),
    kelt_datum: BUDAPEST_DAY.format(printedAt),
  };
}

/**
 * THE CONTRACT AS A PDF: the branded header (eyebrow, the rental number as title), then the filled template block by block,
 * a new page whenever the next block would cross the bottom. `printedAt` is passed in so the same rental printed at the same
 * moment gives the same bytes.
 */
export function rentalContractDocument(input: {
  rental: Rental;
  template: string;
  settings: Pick<RentalSettings, "lateFeeMultiplier" | "replacementAfterDays">;
  printedAt: Date;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf({ creationDate: input.printedAt });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const filled = fillRentalContractTemplate(
        input.template,
        rentalContractValues(input.rental, input.settings, input.printedAt),
      );
      let y = PDF_FIRST_CONTENT_TOP;
      const need = (height: number) => {
        if (y + height <= PDF_CONTENT_BOTTOM) return;
        addPage(document);
        y = PDF_CONTINUATION_CONTENT_TOP;
      };

      for (const block of rentalContractBlocks(filled)) {
        if (block.kind === "heading") {
          document.fontSize(11.5);
          const height = document.heightOfString(block.text, {
            width: PDF_CONTENT_WIDTH,
          });
          need(height + 30);
          y += 6;
          document
            .fillColor(PDF_INK)
            .text(block.text, PDF_LEFT, y, { width: PDF_CONTENT_WIDTH });
          y += height + 8;
        } else if (block.kind === "signatures") {
          need(70);
          y += 34;
          const half = (PDF_CONTENT_WIDTH - 40) / 2;
          for (const [index, label] of ["Bérbeadó", "Bérlő"].entries()) {
            const x = PDF_LEFT + index * (half + 40);
            document
              .moveTo(x, y)
              .lineTo(x + half, y)
              .strokeColor(PDF_MUTED)
              .lineWidth(0.75)
              .stroke();
            document
              .fillColor(PDF_MUTED)
              .fontSize(9)
              .text(label, x, y + 5, { width: half, align: "center" });
          }
          y += 30;
        } else {
          const text = block.lines.join("\n");
          document.fontSize(9.5);
          const height = document.heightOfString(text, {
            width: PDF_CONTENT_WIDTH,
            lineGap: 2,
          });
          need(
            Math.min(height, PDF_CONTENT_BOTTOM - PDF_CONTINUATION_CONTENT_TOP),
          );
          document.fillColor(PDF_INK).text(text, PDF_LEFT, y, {
            width: PDF_CONTENT_WIDTH,
            lineGap: 2,
          });
          y = Math.max(y + height, document.y) + 8;
        }
      }

      const range = document.bufferedPageRange();
      for (let page = range.start; page < range.start + range.count; page++) {
        document.switchToPage(page);
        drawDocumentHeader(document, {
          eyebrow: "ESZKÖZBÉRLETI SZERZŐDÉS",
          title: input.rental.rentalNumber,
          subtitle: `${input.rental.equipment.name} · ${input.rental.customer.displayName}`,
          compact: page !== range.start,
        });
        drawDocumentFooter(document, "OFFICE");
      }
      document.end();
    } catch (error) {
      reject(error);
    }
  });
}
