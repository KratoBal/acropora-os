import {
  ACROPORA_COMPANY,
  fillRentalContractTemplate,
  formatMoney,
  RENTAL_CONTRACT_MISSING_VALUE,
  rentalContractBlocks,
  type Rental,
  type RentalContractBlock,
  type RentalContractValues,
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
 * The values of the contract's places, from the rental's own copy of the terms (never from the device's current row or
 * today's Settings: the contract prints what was agreed). Times on the Budapest clock; a setting not decided when the rental
 * was recorded prints as such. Dated on the rental's first day, never the day of a reprint (barracuda, #2360).
 */
export function rentalContractValues(rental: Rental): RentalContractValues {
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
      rental.lateFeeMultiplier === null
        ? RENTAL_CONTRACT_MISSING_VALUE
        : NUMBER.format(rental.lateFeeMultiplier),
    kesedelem_napok:
      rental.replacementAfterDays === null
        ? RENTAL_CONTRACT_MISSING_VALUE
        : String(rental.replacementAfterDays),
    kelt_datum: BUDAPEST_DAY.format(new Date(rental.startsAt)),
  };
}

/**
 * THE SPACING OF THE CONTRACT. The normal one first; the compact one only when the normal does not give two pages, or leaves a
 * signature block alone on its page (Balázs, 2026-11-10 14:15 UTC, msg 1569717175214670000: the printed contract was three pages,
 * the last one two lines).
 */
interface ContractStyle {
  body: number;
  lineGap: number;
  paragraphGap: number;
  heading: number;
  headingBefore: number;
  headingAfter: number;
  signatureBefore: number;
  signatureAfter: number;
}
const NORMAL: ContractStyle = {
  body: 9.5,
  lineGap: 2,
  paragraphGap: 6,
  heading: 11.5,
  headingBefore: 4,
  headingAfter: 6,
  signatureBefore: 30,
  signatureAfter: 26,
};
const COMPACT: ContractStyle = {
  body: 9,
  lineGap: 1.5,
  paragraphGap: 4,
  heading: 11,
  headingBefore: 3,
  headingAfter: 4,
  signatureBefore: 26,
  signatureAfter: 22,
};
/** The pages Balázs asked for; a longer text (an edited template) still prints in full, on more pages. */
const TARGET_PAGES = 2;

interface Layout {
  pages: number;
  /** The index of a signature block that would start a page alone, or null. */
  lonelySignature: number | null;
}

/**
 * LAYS THE BLOCKS OUT ON `document`, a new page whenever the next block would cross the bottom. `breakBefore` names blocks that
 * start a new page anyway: the measuring pass finds a signature block that would stand alone on its page, and the drawing pass
 * moves the paragraph before it (with its heading) over too, so a signature is never cut from the text it signs.
 */
function layOut(
  document: PDFKit.PDFDocument,
  blocks: RentalContractBlock[],
  style: ContractStyle,
  breakBefore: ReadonlySet<number> = new Set(),
): Layout {
  let y = PDF_FIRST_CONTENT_TOP;
  let page = 0;
  // whether the current page holds anything but a signature block yet
  let pageHasText = false;
  let lonelySignature: number | null = null;
  const newPage = () => {
    addPage(document);
    page += 1;
    y = PDF_CONTINUATION_CONTENT_TOP;
    pageHasText = false;
  };
  const need = (height: number) => {
    if (y + height > PDF_CONTENT_BOTTOM) newPage();
  };

  const PARAGRAPH = { width: PDF_CONTENT_WIDTH, lineGap: style.lineGap };
  const heightOf = (text: string) => document.heightOfString(text, PARAGRAPH);
  /**
   * A paragraph taller than the room left is split between words onto the next pages HERE: the document has no margins
   * (the header and footer are drawn into them afterwards), so pdfkit's own page break would start the rest at the very top
   * of the page, under the header (barracuda, #2360). Each piece is the longest run of words that fits.
   */
  const writeParagraph = (text: string) => {
    let rest = text;
    while (rest !== "") {
      const room = PDF_CONTENT_BOTTOM - y;
      const height = heightOf(rest);
      if (height <= room) {
        document.text(rest, PDF_LEFT, y, PARAGRAPH);
        y += height + style.paragraphGap;
        pageHasText = true;
        return;
      }
      // each piece keeps the space or line break after it, so joining the pieces gives the text back
      const words = rest.split(/(?<=\s)/);
      let low = 0;
      let high = words.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (heightOf(words.slice(0, mid).join("").trimEnd()) <= room) low = mid;
        else high = mid - 1;
      }
      // not even one word fits a fresh page: write it anyway, or this would turn pages forever
      const fits = low === 0 && y === PDF_CONTINUATION_CONTENT_TOP ? 1 : low;
      if (fits > 0)
        document.text(
          words.slice(0, fits).join("").trimEnd(),
          PDF_LEFT,
          y,
          PARAGRAPH,
        );
      rest = words.slice(fits).join("");
      newPage();
    }
  };

  blocks.forEach((block, index) => {
    if (breakBefore.has(index) && pageHasText) newPage();
    if (block.kind === "heading") {
      document.fontSize(style.heading);
      const height = document.heightOfString(block.text, {
        width: PDF_CONTENT_WIDTH,
      });
      // a heading never ends a page: it needs room for itself and a line of what follows
      need(style.headingBefore + height + style.headingAfter + 24);
      y += style.headingBefore;
      document
        .fillColor(PDF_INK)
        .text(block.text, PDF_LEFT, y, { width: PDF_CONTENT_WIDTH });
      y += height + style.headingAfter;
      pageHasText = true;
    } else if (block.kind === "signatures") {
      const before = page;
      need(style.signatureBefore + style.signatureAfter + 10);
      if (page !== before && lonelySignature === null) lonelySignature = index;
      y += style.signatureBefore;
      const half = (PDF_CONTENT_WIDTH - 40) / 2;
      for (const [column, label] of ["Bérbeadó", "Bérlő"].entries()) {
        const x = PDF_LEFT + column * (half + 40);
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
      y += style.signatureAfter;
    } else {
      document.fontSize(style.body).fillColor(PDF_INK);
      writeParagraph(block.lines.join("\n"));
    }
  });
  return { pages: page + 1, lonelySignature };
}

/** The layout a style gives, measured on a throwaway document (pdfkit cannot take a page back). */
function measure(
  blocks: RentalContractBlock[],
  style: ContractStyle,
  breakBefore?: ReadonlySet<number>,
): Layout {
  const scratch = createBrandedPdf();
  const layout = layOut(scratch, blocks, style, breakBefore);
  scratch.on("data", () => undefined);
  scratch.end();
  return layout;
}

/**
 * WHICH STYLE, AND WHERE A SIGNATURE NEEDS COMPANY: the normal spacing when it gives at most two pages with no signature alone,
 * else the compact one; if a signature would still stand alone, the paragraph before it (and its heading) goes over with it.
 */
export function contractLayoutPlan(blocks: RentalContractBlock[]): {
  style: ContractStyle;
  breakBefore: Set<number>;
} {
  const normal = measure(blocks, NORMAL);
  const style =
    normal.pages <= TARGET_PAGES && normal.lonelySignature === null
      ? NORMAL
      : COMPACT;
  const breakBefore = new Set<number>();
  const chosen = style === NORMAL ? normal : measure(blocks, COMPACT);
  if (chosen.lonelySignature !== null) {
    let from = chosen.lonelySignature - 1;
    if (blocks[from - 1]?.kind === "heading") from -= 1;
    if (from >= 0 && blocks[from]?.kind !== "signatures") breakBefore.add(from);
  }
  return { style, breakBefore };
}

/**
 * THE CONTRACT AS A PDF: the branded header (eyebrow, the rental number as title), then the filled template block by block
 * (`layOut`, with the spacing `contractLayoutPlan` chose). `printedAt` is passed in so the same rental printed at the same
 * moment gives the same bytes.
 */
export function rentalContractDocument(input: {
  rental: Rental;
  template: string;
  printedAt: Date;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = createBrandedPdf({ creationDate: input.printedAt });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    try {
      const blocks = rentalContractBlocks(
        fillRentalContractTemplate(
          input.template,
          rentalContractValues(input.rental),
        ),
      );
      const plan = contractLayoutPlan(blocks);
      layOut(document, blocks, plan.style, plan.breakBefore);

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
