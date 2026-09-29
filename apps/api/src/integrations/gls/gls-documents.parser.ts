import {
  excelSerialDate,
  readXlsxSheets,
  type CellValue,
  type SheetRows,
} from "./xlsx-rows.js";

/**
 * THE TWO GLS DOCUMENTS, READ (#GLS elszámolás, 2026-09-29).
 *
 * GLS sends two separate mails where Foxpost sends one:
 *
 *   - the COD report ("Utánvét részletező", weekly, utanvet@): the money
 *     transferred, parcel by parcel, with the COD reference;
 *   - the invoice attachment ("Számlamelléklet", about every two weeks,
 *     szamlamelleklet@): GLS's fee invoice, parcel by parcel, with the
 *     client and COD references and the card fee.
 *
 * Built and measured on the whole archive exported on 2026-09-29: 219 COD
 * reports (2022-2026) and 81 invoice attachments (2023-2026).
 *
 * Columns are found by their LABEL, never by position: the surcharge sheet
 * comes in 9 column layouts, and the 2022 COD reports carry English labels.
 * The addressee's name and address columns are never read.
 */

export class GlsDocumentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GlsDocumentError";
  }
}

export interface GlsCodReportLine {
  /** The sheet row (1-based), stable for one file. */
  rowNumber: number;
  reportNumber: string | null;
  parcelNumber: string;
  codReference: string | null;
  deliveryDate: string | null;
  amount: number;
}

export interface GlsCodReport {
  /** YYYY-MM-DD */
  transferDate: string;
  currency: string;
  total: number;
  lines: GlsCodReportLine[];
}

export interface GlsInvoiceParcel {
  parcelNumber: string;
  clientReference: string | null;
  codReference: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  /** The parcel's total on the invoice ("VÉGÖSSZEG / Total amount"). */
  fee: number;
  codValue: number | null;
  codFee: number | null;
  cardFee: number | null;
}

export interface GlsInvoiceAttachment {
  invoiceNumber: string;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  currency: string;
  parcels: GlsInvoiceParcel[];
  /** Sum of the parcels' totals. */
  feeTotal: number;
  /** Sum of the card fees. */
  cardFeeTotal: number;
}

export type GlsDocument =
  | { kind: "COD_REPORT"; report: GlsCodReport }
  | { kind: "INVOICE_ATTACHMENT"; attachment: GlsInvoiceAttachment };

const COD_LABELS = {
  report: ["Jelentés szám", "Journal No."],
  parcel: ["Csomagszám", "Parcel Number"],
  reference: ["Utánvét hivatkozás", "COD Reference"],
  delivery: ["Kiszállítási dátum", "Delivery Date"],
  amount: ["Utánvét összeg", "COD Amount"],
} as const;
const TRANSFER_DATE_LABELS = ["Utalás dátuma", "Release Date"];

function text(value: CellValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out === "" ? null : out;
}

function amount(value: CellValue | undefined, code: string): number {
  const number =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .replace(/\s/g, "")
            .replace(",", "."),
        );
  if (!Number.isFinite(number)) throw new GlsDocumentError(code);
  return number;
}

function optionalAmount(value: CellValue | undefined): number | null {
  return value === null || value === undefined || value === ""
    ? null
    : amount(value, "GLS_AMOUNT_INVALID");
}

/** Every date form the files carry, as YYYY-MM-DD. */
export function glsDate(value: CellValue | undefined): string | null {
  if (typeof value === "number") return isoDay(excelSerialDate(value));
  const raw = text(value);
  if (!raw) return null;
  // "2026-09-03", "2026.09.03", "2026. 09. 03."
  const parts = /^(\d{4})[-.]\s?(\d{2})[-.]\s?(\d{2})\.?(?:[T ].*)?$/.exec(raw);
  if (!parts) throw new GlsDocumentError("GLS_DATE_INVALID");
  return `${parts[1]}-${parts[2]}-${parts[3]}`;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Money to the cent, so that sums compare exactly. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

function findColumn(
  header: readonly CellValue[],
  labels: readonly string[],
): number {
  const index = header.findIndex((cell) => {
    const label = text(cell);
    return label !== null && labels.includes(label);
  });
  return index;
}

function readCodReport(rows: SheetRows): GlsCodReport {
  const headerIndex = rows.findIndex(
    (row) => findColumn(row, COD_LABELS.parcel) >= 0,
  );
  if (headerIndex < 0) throw new GlsDocumentError("GLS_COD_HEADER_MISSING");
  const header = rows[headerIndex]!;
  const column = Object.fromEntries(
    Object.entries(COD_LABELS).map(([key, labels]) => [
      key,
      findColumn(header, labels),
    ]),
  ) as Record<keyof typeof COD_LABELS, number>;
  if (Object.values(column).some((index) => index < 0))
    throw new GlsDocumentError("GLS_COD_COLUMN_MISSING");

  // "Utalás dátuma: 2026. 09. 03." in one cell, or the label and the date
  // in two ("Release Date" | "2022-02-10")
  let transferDate: string | null = null;
  for (const row of rows.slice(0, headerIndex))
    row.forEach((cell, index) => {
      const label = text(cell);
      const matched = TRANSFER_DATE_LABELS.find((name) =>
        label?.startsWith(name),
      );
      if (!label || !matched || transferDate) return;
      const inline = label.slice(matched.length).replace(/^:+\s*/, "");
      transferDate = inline
        ? glsDate(inline)
        : glsDate(row.slice(index + 1).find((next) => text(next) !== null));
    });
  if (!transferDate)
    throw new GlsDocumentError("GLS_COD_TRANSFER_DATE_MISSING");

  const lines: GlsCodReportLine[] = [];
  const currencies = new Set<string>();
  let total: number | null = null;
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index]!;
    const parcel = text(row[column.parcel]);
    if (!parcel) {
      // the total row: an amount under the amount column, nothing else
      if (total === null && text(row[column.amount]) !== null)
        total = amount(row[column.amount], "GLS_COD_TOTAL_INVALID");
      continue;
    }
    const currency = text(row[column.amount + 1]);
    if (currency) currencies.add(currency);
    lines.push({
      rowNumber: index + 1,
      reportNumber: text(row[column.report]),
      parcelNumber: parcel,
      codReference: text(row[column.reference]),
      deliveryDate: glsDate(row[column.delivery]),
      amount: amount(row[column.amount], "GLS_COD_AMOUNT_INVALID"),
    });
  }
  if (lines.length === 0) throw new GlsDocumentError("GLS_COD_LINES_MISSING");
  if (total === null) throw new GlsDocumentError("GLS_COD_TOTAL_MISSING");
  const sum = cents(lines.reduce((acc, line) => acc + line.amount, 0));
  if (sum !== cents(total))
    throw new GlsDocumentError("GLS_COD_TOTAL_MISMATCH");
  if (currencies.size > 1) throw new GlsDocumentError("GLS_COD_CURRENCY_MIXED");
  return {
    transferDate,
    currency: [...currencies][0] ?? "HUF",
    total: cents(total),
    lines,
  };
}

/** The English half of a bilingual GLS label ("Csomagszám / Parcel number"). */
function englishLabel(cell: CellValue): string {
  const label = text(cell) ?? "";
  const slash = label.lastIndexOf(" / ");
  return (slash < 0 ? label : label.slice(slash + 3)).trim().toLowerCase();
}

function labelledRows(
  rows: SheetRows | undefined,
): Array<(label: string) => CellValue> {
  if (!rows || rows.length === 0) return [];
  const header = rows[0]!.map(englishLabel);
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => text(cell) !== null))
    .map((row) => (label: string) => {
      const index = header.indexOf(label.toLowerCase());
      return index < 0 ? null : (row[index] ?? null);
    });
}

function readInvoiceAttachment(
  sheets: Map<string, SheetRows>,
  fileName: string,
): GlsInvoiceAttachment {
  const deliveries = labelledRows(sheets.get("Delivery Details"));
  const surcharges = labelledRows(sheets.get("Services Surcharges details"));
  const cards = labelledRows(sheets.get("Credit card fee details"));

  const invoiceNumbers = new Set(
    deliveries
      .map((row) => text(row("Invoice number")))
      .filter((value): value is string => value !== null),
  );
  if (invoiceNumbers.size > 1)
    throw new GlsDocumentError("GLS_INVOICE_NUMBER_MIXED");
  // one measured file has no parcel at all, only a card fee: the number is
  // then only in the file name ("SettlementDocument_HU00391589_...")
  const invoiceNumber =
    [...invoiceNumbers][0] ??
    /SettlementDocument_([A-Z]{2}\d+)_/.exec(fileName)?.[1];
  if (!invoiceNumber) throw new GlsDocumentError("GLS_INVOICE_NUMBER_MISSING");
  const invoiceDate = deliveries[0]
    ? glsDate(deliveries[0]("Invoice date"))
    : null;

  const byParcel = new Map<string, GlsInvoiceParcel>();
  const currencies = new Set<string>();
  for (const row of deliveries) {
    const parcelNumber = text(row("Parcel number"));
    if (!parcelNumber) continue;
    const currency = text(row("Currency"));
    if (currency) currencies.add(currency);
    byParcel.set(parcelNumber, {
      parcelNumber,
      clientReference: text(row("Client reference")),
      codReference: text(row("COD Reference")),
      pickupDate: glsDate(row("Pick up date")),
      deliveryDate: glsDate(row("Delivery date")),
      fee: amount(row("Total amount"), "GLS_INVOICE_FEE_INVALID"),
      codValue: null,
      codFee: null,
      cardFee: null,
    });
  }
  for (const row of surcharges) {
    const parcel = byParcel.get(text(row("Parcel number")) ?? "");
    if (!parcel) continue;
    parcel.codValue = optionalAmount(row("COD value"));
    parcel.codFee = optionalAmount(row("Cash on delivery fee"));
  }
  let cardFeeTotal = 0;
  for (const row of cards) {
    const parcelNumber = text(row("Parcel ID"));
    const fee = amount(row("Total amount"), "GLS_INVOICE_CARD_FEE_INVALID");
    cardFeeTotal += fee;
    if (!parcelNumber) continue;
    const parcel = byParcel.get(parcelNumber);
    if (parcel) parcel.cardFee = cents((parcel.cardFee ?? 0) + fee);
    else
      // a card fee for a parcel invoiced earlier
      byParcel.set(parcelNumber, {
        parcelNumber,
        clientReference: text(row("Client reference")),
        codReference: text(row("COD Reference")),
        pickupDate: null,
        deliveryDate: null,
        fee: 0,
        codValue: null,
        codFee: null,
        cardFee: fee,
      });
  }
  if (currencies.size > 1)
    throw new GlsDocumentError("GLS_INVOICE_CURRENCY_MIXED");
  const parcels = [...byParcel.values()];
  return {
    invoiceNumber,
    invoiceDate,
    currency: [...currencies][0] ?? "HUF",
    parcels,
    feeTotal: cents(parcels.reduce((acc, parcel) => acc + parcel.fee, 0)),
    cardFeeTotal: cents(cardFeeTotal),
  };
}

/** Either GLS document, told apart by its sheets. */
export function readGlsDocument(buffer: Buffer, fileName: string): GlsDocument {
  let sheets: Map<string, SheetRows>;
  try {
    sheets = readXlsxSheets(buffer);
  } catch {
    throw new GlsDocumentError("GLS_XLSX_INVALID");
  }
  if (sheets.has("Delivery Details"))
    return {
      kind: "INVOICE_ATTACHMENT",
      attachment: readInvoiceAttachment(sheets, fileName),
    };
  const first = sheets.values().next().value;
  if (first && first.some((row) => findColumn(row, COD_LABELS.parcel) >= 0))
    return { kind: "COD_REPORT", report: readCodReport(first) };
  throw new GlsDocumentError("GLS_DOCUMENT_UNKNOWN");
}
