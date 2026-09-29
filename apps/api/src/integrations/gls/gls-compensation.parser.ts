import { PAGE_END_MARKER } from "../../purchasing/supplier-invoice-import/pdf-text-lines.js";
import { GlsDocumentError } from "./gls-documents.parser.js";

/**
 * THE GLS COMPENSATION LETTER ("Kompenzációs értesítő", dunning@, a PDF),
 * READ (Balázs, 2026-09-29 12:14 UTC: "beszedett összeg - kompenzáció =
 * ténylegesen utalt").
 *
 * GLS does NOT always transfer the whole COD amount: on the day of a COD
 * transfer it may set its own open invoices against it, and says so in this
 * letter. One row: the COD collected, the amount set off, the COD actually
 * transferred, the GLS invoices set off, their open amount, and what stays
 * open after it.
 *
 * Built on three letters (2026-08-27, 09-03, 09-10; acrobot, from info@):
 *
 *   COD      set off   transferred   invoices                         debt     left
 *   6 950    6 950     0             HU00905612 HU00898334 HU00912382  14 963   8 013
 *   117 450  8 013     109 437       HU00912382                         8 013   0
 *   28 900   18 111    10 789        HU00920611                        18 111   0
 *
 * The COD amount equals that day's COD report total (09-03: 117 450, 09-10:
 * 28 900), and the debt of a single invoice equals its gross total (HU00920611:
 * 18 111). What is left open is set off on a later letter (the 8 013 of 08-27
 * on 09-03).
 *
 * The PDF has a text layer, but its cells join unevenly ("109 437
 * HU00912382" is one cell), so the row is read by the SHAPE of its values,
 * not by column. It is accepted only when both of its own sums hold: COD -
 * set off = transferred, and debt - set off = left open. A letter with more
 * than one row is refused rather than guessed: none has been seen yet.
 */

export interface GlsCompensation {
  /** YYYY-MM-DD, the day of the set-off (and of the COD transfer). */
  date: string;
  clientNumber: string;
  cod: number;
  compensated: number;
  transferred: number;
  /** GLS invoice numbers (or parcel numbers) the amount was set against. */
  references: string[];
  debt: number;
  remaining: number;
}

const TITLE = /KOMPENZÁCIÓS ÉRTESÍTŐ/i;
const DATE = /\b(\d{4})\.(\d{2})\.(\d{2})\.?/g;
const INVOICE = /\bHU\d{8}\b/g;
const LONG_NUMBER = /\b\d{9,}\b/g;
// a Hungarian amount: groups of three after a space ("117 450")
const AMOUNT = /\d{1,3}(?:[   ]\d{3})*/g;

export function isGlsCompensationLetter(lines: readonly string[]): boolean {
  return lines.some((line) => TITLE.test(line));
}

export function readGlsCompensationLetter(
  lines: readonly string[],
): GlsCompensation {
  if (!isGlsCompensationLetter(lines))
    throw new GlsDocumentError("GLS_DOCUMENT_UNKNOWN");
  // the table's last header line starts with the currency row
  const headerEnd = lines
    .map((line) => line.startsWith("(HUF)"))
    .lastIndexOf(true);
  const placeLine = lines.findIndex(
    (line, index) =>
      index > headerEnd && /^[^|]+, \d{4}\.\d{2}\.\d{2}\.?$/.test(line.trim()),
  );
  if (headerEnd < 0 || placeLine < 0)
    throw new GlsDocumentError("GLS_COMPENSATION_UNREADABLE");
  const row = lines
    .slice(headerEnd + 1, placeLine)
    .filter((line) => line !== PAGE_END_MARKER)
    .join(" | ");

  const dates = [...row.matchAll(DATE)];
  if (dates.length !== 1)
    throw new GlsDocumentError(
      dates.length === 0
        ? "GLS_COMPENSATION_UNREADABLE"
        : "GLS_COMPENSATION_MULTIPLE_ROWS",
    );
  const [, year, month, day] = dates[0]!;
  let rest = row.replace(DATE, "  ");

  const references = [...rest.matchAll(INVOICE)].map((match) => match[0]);
  rest = rest.replace(INVOICE, "  ");
  const longNumbers = [...rest.matchAll(LONG_NUMBER)].map((match) => match[0]);
  // the first long number is the client number; any further ones are parcels
  const [clientNumber, ...parcels] = longNumbers;
  if (!clientNumber) throw new GlsDocumentError("GLS_COMPENSATION_UNREADABLE");
  rest = rest.replace(LONG_NUMBER, "  ");
  // a cell border keeps two amounts apart even where the cells run together
  rest = rest.replace(/[|,]/g, "  ").replace(/[^\d   ]/g, "  ");

  const amounts = [...rest.matchAll(AMOUNT)].map((match) =>
    Number(match[0].replace(/\D/g, "")),
  );
  if (amounts.length !== 5)
    throw new GlsDocumentError("GLS_COMPENSATION_UNREADABLE");
  const [cod, compensated, transferred, debt, remaining] = amounts as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (cod - compensated !== transferred || debt - compensated !== remaining)
    throw new GlsDocumentError("GLS_COMPENSATION_SUM_MISMATCH");
  return {
    date: `${year}-${month}-${day}`,
    clientNumber,
    cod,
    compensated,
    transferred,
    references: [...references, ...parcels],
    debt,
    remaining,
  };
}
