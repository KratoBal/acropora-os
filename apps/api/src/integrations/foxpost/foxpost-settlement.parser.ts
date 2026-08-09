import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_SOURCE_FILE_BYTES = 15 * 1024 * 1024;

export class FoxpostParseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "FoxpostParseError";
  }
}

export interface ParsedFoxpostCodLine {
  sourceRowNumber: number;
  referenceCode: string;
  transactionDate: Date;
  recipientName: string | null;
  parcelBarcode: string | null;
  collectedAmount: number;
}

export interface ParsedFoxpostSettlementXlsx {
  partnerCode: string;
  settlementCode: string;
  periodStart: Date;
  periodEnd: Date;
  collectedAmount: number;
  invoiceGrossAmount: number;
  transferredAmount: number;
  currency: string;
  lines: ParsedFoxpostCodLine[];
}

export interface ParsedFoxpostInvoicePdf {
  partnerCode: string;
  settlementCode: string;
  periodStart: Date;
  periodEnd: Date;
  invoiceNumber: string;
  invoiceIssueDate: Date;
  invoiceGrossAmount: number;
  currency: string;
}

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined)
      return textOf(value.result as ExcelJS.CellValue);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((part) => part.text).join("");
  }
  return String(value).trim();
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function numberOf(value: ExcelJS.CellValue, code: string): number {
  const raw =
    typeof value === "number"
      ? value
      : Number(
          textOf(value)
            .replace(/[\s\u00a0]/g, "")
            .replace(",", "."),
        );
  if (!Number.isFinite(raw)) throw new FoxpostParseError(code);
  return raw;
}

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new FoxpostParseError("FOXPOST_DATE_INVALID");
  return date;
}

function dateOf(value: ExcelJS.CellValue, code: string): Date {
  if (value instanceof Date)
    return utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  const raw = textOf(value);
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact)
    return utcDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  throw new FoxpostParseError(code);
}

function findSheet(
  workbook: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet {
  const sheet = workbook.worksheets.find(
    (candidate) => normalized(candidate.name) === normalized(name),
  );
  if (!sheet) throw new FoxpostParseError("FOXPOST_XLSX_SHEET_MISSING");
  return sheet;
}

function findSummaryValue(
  sheet: ExcelJS.Worksheet,
  label: string,
  takeLast = false,
): ExcelJS.CellValue {
  const matches: ExcelJS.CellValue[] = [];
  sheet.eachRow((row) => {
    if (normalized(textOf(row.getCell(1).value)) === normalized(label))
      matches.push(row.getCell(2).value);
  });
  const value = takeLast ? matches.at(-1) : matches[0];
  if (value === undefined)
    throw new FoxpostParseError("FOXPOST_XLSX_SUMMARY_FIELD_MISSING");
  return value;
}

function moneyFromPdfToken(value: string): number | null {
  let raw = value
    .replace(/HUF/gi, "")
    .replace(/[\s\u00a0]/g, "")
    .trim();
  if (!/^[\d.,]+$/.test(raw)) return null;
  if (raw.includes(",") && raw.includes(".")) {
    raw =
      raw.lastIndexOf(".") > raw.lastIndexOf(",")
        ? raw.replace(/,/g, "")
        : raw.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(,\d{3})+$/.test(raw)) {
    raw = raw.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    raw = raw.replace(/\./g, "");
  } else {
    raw = raw.replace(",", ".");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function nearbyToken(
  tokens: readonly string[],
  label: string,
  matches: (value: string) => boolean,
): string | null {
  const index = tokens.findIndex(
    (token) => normalized(token) === normalized(label),
  );
  if (index < 0) return null;
  for (let distance = 1; distance <= 6; distance += 1) {
    const before = tokens[index - distance];
    if (before && matches(before)) return before;
    const after = tokens[index + distance];
    if (after && matches(after)) return after;
  }
  return null;
}

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pdfDate(value: string): Date | null {
  const match = /^(\d{4})\.\s*([A-Za-z]{3})\s*(\d{1,2})\.?$/.exec(value.trim());
  if (!match) return null;
  const month = ENGLISH_MONTHS[match[2]!.toLowerCase()];
  return month ? utcDate(Number(match[1]), month, Number(match[3])) : null;
}

export function parseFoxpostInvoiceTokens(
  tokens: readonly string[],
): ParsedFoxpostInvoicePdf {
  const cleaned = tokens.map((token) => token.trim()).filter(Boolean);
  const invoiceNumber =
    nearbyToken(cleaned, "Invoice No.", (value) => /^FX\d{6,}$/i.test(value)) ??
    cleaned.find((value) => /^FX\d{6,}$/i.test(value));
  const partnerCode =
    nearbyToken(cleaned, "Partner code", (value) => /^W\d{5,}$/i.test(value)) ??
    cleaned.find((value) => /^W\d{5,}$/i.test(value));
  const issueDateToken = nearbyToken(
    cleaned,
    "Invoice date",
    (value) => pdfDate(value) !== null,
  );
  const totalToken = nearbyToken(
    cleaned,
    "Invoice total",
    (value) => /HUF/i.test(value) && moneyFromPdfToken(value) !== null,
  );
  const periodToken = cleaned.find((value) =>
    /Elsz[aá]mol[aá]si id[oő]szak:/i.test(value),
  );
  const periodMatch = periodToken
    ? /(?:Elsz[aá]mol[aá]si id[oő]szak:)\s*(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}H\d{2})/i.exec(
        periodToken,
      )
    : null;
  const total = totalToken ? moneyFromPdfToken(totalToken) : null;
  const issueDate = issueDateToken ? pdfDate(issueDateToken) : null;
  if (
    !invoiceNumber ||
    !partnerCode ||
    !issueDate ||
    total === null ||
    !periodMatch
  )
    throw new FoxpostParseError("FOXPOST_PDF_REQUIRED_FIELD_MISSING");

  return {
    invoiceNumber: invoiceNumber.toUpperCase(),
    partnerCode: partnerCode.toUpperCase(),
    invoiceIssueDate: issueDate,
    invoiceGrossAmount: total,
    currency: "HUF",
    periodStart: dateOf(periodMatch[1], "FOXPOST_PDF_PERIOD_INVALID"),
    periodEnd: dateOf(periodMatch[2], "FOXPOST_PDF_PERIOD_INVALID"),
    settlementCode: periodMatch[3]!.toUpperCase(),
  };
}

export function validateFoxpostPair(
  xlsx: ParsedFoxpostSettlementXlsx,
  pdf: ParsedFoxpostInvoicePdf,
): void {
  if (xlsx.partnerCode !== pdf.partnerCode)
    throw new FoxpostParseError("FOXPOST_PARTNER_CODE_MISMATCH");
  if (xlsx.settlementCode !== pdf.settlementCode)
    throw new FoxpostParseError("FOXPOST_SETTLEMENT_CODE_MISMATCH");
  if (xlsx.periodStart.getTime() !== pdf.periodStart.getTime())
    throw new FoxpostParseError("FOXPOST_PERIOD_MISMATCH");
  if (xlsx.periodEnd.getTime() !== pdf.periodEnd.getTime())
    throw new FoxpostParseError("FOXPOST_PERIOD_MISMATCH");
  if (Math.abs(xlsx.invoiceGrossAmount - pdf.invoiceGrossAmount) > 0.01)
    throw new FoxpostParseError("FOXPOST_INVOICE_TOTAL_MISMATCH");
  if (
    Math.abs(
      xlsx.collectedAmount - xlsx.invoiceGrossAmount - xlsx.transferredAmount,
    ) > 0.01
  )
    throw new FoxpostParseError("FOXPOST_TRANSFER_TOTAL_MISMATCH");
}

@Injectable()
export class FoxpostSettlementParser {
  async parseXlsx(buffer: Buffer): Promise<ParsedFoxpostSettlementXlsx> {
    if (buffer.length === 0 || buffer.length > MAX_SOURCE_FILE_BYTES)
      throw new FoxpostParseError("FOXPOST_XLSX_SIZE_INVALID");
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new FoxpostParseError("FOXPOST_XLSX_INVALID");
    }
    const summary = findSheet(workbook, "összesítés");
    const cod = findSheet(workbook, "utánvétek");
    const settlementCode = textOf(summary.getCell("A1").value).toUpperCase();
    const partnerCode = textOf(summary.getCell("D1").value).toUpperCase();
    if (!/^\d{2}H\d{2}$/.test(settlementCode) || !/^W\d{5,}$/.test(partnerCode))
      throw new FoxpostParseError("FOXPOST_XLSX_IDENTITY_INVALID");

    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    summary.eachRow((row) => {
      if (
        normalized(textOf(row.getCell(1).value)) ===
        normalized("Elszámolási időszak:")
      ) {
        periodStart = dateOf(
          row.getCell(2).value,
          "FOXPOST_XLSX_PERIOD_INVALID",
        );
        periodEnd = dateOf(row.getCell(4).value, "FOXPOST_XLSX_PERIOD_INVALID");
      }
    });
    if (!periodStart || !periodEnd)
      throw new FoxpostParseError("FOXPOST_XLSX_PERIOD_MISSING");

    let headerRow = 0;
    const columnByLabel = new Map<string, number>();
    for (
      let rowNumber = 1;
      rowNumber <= Math.min(cod.rowCount, 30);
      rowNumber += 1
    ) {
      const row = cod.getRow(rowNumber);
      const labels = new Map<string, number>();
      row.eachCell((cell, columnNumber) => {
        labels.set(normalized(textOf(cell.value)), columnNumber);
      });
      if (
        labels.has(normalized("Referencia kód")) &&
        labels.has(normalized("Tranzakció dátuma")) &&
        labels.has(normalized("Beszedett összeg"))
      ) {
        headerRow = rowNumber;
        for (const [label, column] of labels) columnByLabel.set(label, column);
        break;
      }
    }
    if (!headerRow)
      throw new FoxpostParseError("FOXPOST_XLSX_COD_HEADER_MISSING");

    const column = (label: string, required = true): number => {
      const value = columnByLabel.get(normalized(label));
      if (!value && required)
        throw new FoxpostParseError("FOXPOST_XLSX_COD_COLUMN_MISSING");
      return value ?? 0;
    };
    const referenceColumn = column("Referencia kód");
    const dateColumn = column("Tranzakció dátuma");
    const amountColumn = column("Beszedett összeg");
    const recipientColumn = column("Címzett neve", false);
    const barcodeColumn = column("Küldemény vonalkódja", false);
    const lines: ParsedFoxpostCodLine[] = [];
    for (
      let rowNumber = headerRow + 1;
      rowNumber <= cod.rowCount;
      rowNumber += 1
    ) {
      const row = cod.getRow(rowNumber);
      const referenceCode = textOf(row.getCell(referenceColumn).value);
      if (!referenceCode || normalized(referenceCode) === "osszesen:") continue;
      const collectedAmount = numberOf(
        row.getCell(amountColumn).value,
        "FOXPOST_XLSX_COD_AMOUNT_INVALID",
      );
      if (collectedAmount < 0)
        throw new FoxpostParseError("FOXPOST_XLSX_COD_AMOUNT_INVALID");
      lines.push({
        sourceRowNumber: rowNumber,
        referenceCode,
        transactionDate: dateOf(
          row.getCell(dateColumn).value,
          "FOXPOST_XLSX_COD_DATE_INVALID",
        ),
        recipientName: recipientColumn
          ? textOf(row.getCell(recipientColumn).value) || null
          : null,
        parcelBarcode: barcodeColumn
          ? textOf(row.getCell(barcodeColumn).value) || null
          : null,
        collectedAmount,
      });
    }
    if (!lines.length)
      throw new FoxpostParseError("FOXPOST_XLSX_COD_LINES_MISSING");

    const collectedAmount = numberOf(
      findSummaryValue(summary, "Beszedett összeg:"),
      "FOXPOST_XLSX_COLLECTED_TOTAL_INVALID",
    );
    const invoiceGrossAmount = numberOf(
      findSummaryValue(summary, "FOXPOST által számlázandó bruttó összeg:"),
      "FOXPOST_XLSX_INVOICE_TOTAL_INVALID",
    );
    const transferredAmount = numberOf(
      findSummaryValue(summary, "FOXPOST által utalandó összeg:", true),
      "FOXPOST_XLSX_TRANSFER_TOTAL_INVALID",
    );
    const lineTotal = lines.reduce(
      (sum, line) => sum + line.collectedAmount,
      0,
    );
    if (Math.abs(lineTotal - collectedAmount) > 0.01)
      throw new FoxpostParseError("FOXPOST_XLSX_COD_TOTAL_MISMATCH");

    return {
      partnerCode,
      settlementCode,
      periodStart,
      periodEnd,
      collectedAmount,
      invoiceGrossAmount,
      transferredAmount,
      currency: "HUF",
      lines,
    };
  }

  async parsePdf(buffer: Buffer): Promise<ParsedFoxpostInvoicePdf> {
    if (buffer.length === 0 || buffer.length > MAX_SOURCE_FILE_BYTES)
      throw new FoxpostParseError("FOXPOST_PDF_SIZE_INVALID");
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      useSystemFonts: true,
    });
    try {
      const document = await loadingTask.promise;
      const tokens: string[] = [];
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if ("str" in item && item.str.trim()) tokens.push(item.str.trim());
        }
      }
      return parseFoxpostInvoiceTokens(tokens);
    } catch (error) {
      if (error instanceof FoxpostParseError) throw error;
      throw new FoxpostParseError("FOXPOST_PDF_INVALID");
    } finally {
      await loadingTask.destroy();
    }
  }
}
