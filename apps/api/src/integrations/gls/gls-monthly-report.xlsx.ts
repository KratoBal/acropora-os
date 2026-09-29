import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

/**
 * THE MONTHLY GLS FILE FOR THE ACCOUNTANT, on the model of the Foxpost one
 * (`foxpost-monthly-report.xlsx.ts`): one block per money event with the
 * outgoing invoices it paid, monthly totals, and the lines still open on a
 * sheet of their own.
 *
 * Where GLS differs, and why the file differs with it:
 *   - the money event is the COD TRANSFER (the weekly COD report), and the
 *     month is its transfer day;
 *   - GLS does not take its fee from the transfer (measured on the 81 invoice
 *     attachments: the bank-fee sheet is empty, the card fee is invoiced), so
 *     a block has no "Számla" row: Utalt = Beszedett. The fee invoices of the
 *     month stand on their own sheet, by invoice date.
 *
 * Built at every download from what is stored, so it never lags a decision.
 */

export interface GlsReportTransfer {
  transferDate: Date;
  fileName: string;
  total: number;
  invoiceNumbers: string[];
  unresolvedLines: GlsReportUnresolvedLine[];
}

export interface GlsReportUnresolvedLine {
  rowNumber: number;
  parcelNumber: string;
  codReference: string | null;
  amount: number;
  reason: string;
}

export interface GlsReportInvoice {
  invoiceNumber: string;
  invoiceDate: Date | null;
  parcelCount: number;
  feeTotal: number;
  cardFeeTotal: number;
}

const FONT = "Aptos";
const MONEY = '#,##0 "Ft"';

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function headerRow(sheet: ExcelJS.Worksheet): void {
  const row = sheet.getRow(1);
  row.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF334155" },
  };
  row.height = 22;
}

@Injectable()
export class GlsMonthlyReportXlsx {
  async build(
    year: number,
    month: number,
    transferSource: readonly GlsReportTransfer[],
    invoiceSource: readonly GlsReportInvoice[],
  ): Promise<{ filename: string; buffer: Buffer }> {
    const transfers = [...transferSource].sort(
      (a, b) =>
        a.transferDate.getTime() - b.transferDate.getTime() ||
        a.fileName.localeCompare(b.fileName, "hu"),
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Acropora OS";
    workbook.company = "Acropora Kft.";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("GLS", {
      views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
      pageSetup: {
        orientation: "portrait",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    sheet.columns = [
      { key: "date", width: 15 },
      { key: "invoice", width: 25 },
      { key: "space", width: 3 },
      { key: "label", width: 14 },
      { key: "amount", width: 18 },
    ];
    sheet.mergeCells("A1:E1");
    sheet.getCell("A1").value = "GLS";
    sheet.getCell("A1").font = { name: FONT, size: 16, bold: true };
    sheet.mergeCells("A2:E2");
    sheet.getCell("A2").value = monthLabel(year, month);
    sheet.getCell("A2").font = {
      name: FONT,
      size: 10,
      color: { argb: "FF64748B" },
    };

    let rowNumber = 4;
    const collectedCells: string[] = [];
    const transferredCells: string[] = [];
    for (const transfer of transfers) {
      const invoiceNumbers = [...new Set(transfer.invoiceNumbers)].sort(
        (a, b) => a.localeCompare(b, "hu", { numeric: true }),
      );
      const blockHeight = Math.max(2, invoiceNumbers.length);
      const first = rowNumber;
      sheet.getCell(first, 1).value = transfer.transferDate;
      sheet.getCell(first, 1).numFmt = "yyyy-mm-dd";
      invoiceNumbers.forEach((invoiceNumber, index) => {
        sheet.getCell(first + index, 2).value = invoiceNumber;
      });
      sheet.getCell(first, 4).value = "Beszedett";
      sheet.getCell(first, 5).value = transfer.total;
      sheet.getCell(first + 1, 4).value = "Utalt";
      // GLS transfers the whole COD amount: the fee is invoiced apart
      sheet.getCell(first + 1, 5).value = {
        formula: `E${first}`,
        result: transfer.total,
      };
      collectedCells.push(`E${first}`);
      transferredCells.push(`E${first + 1}`);
      for (let row = first; row < first + blockHeight; row++)
        for (let column = 1; column <= 5; column++) {
          const cell = sheet.getCell(row, column);
          cell.font = { name: FONT, size: 11, bold: column === 4 };
          if (column === 5) cell.numFmt = MONEY;
          if (row === first)
            cell.border = {
              top: { style: "thin", color: { argb: "FFCBD5E1" } },
            };
        }
      rowNumber += blockHeight + 1;
    }
    const totalsRow = rowNumber + 1;
    sheet.getCell(totalsRow, 4).value = "Havi összesen";
    sheet.getCell(totalsRow, 4).font = { name: FONT, size: 11, bold: true };
    (
      [
        ["Beszedett", collectedCells],
        ["Utalt", transferredCells],
      ] as const
    ).forEach(([label, cells], index) => {
      const row = totalsRow + 1 + index;
      sheet.getCell(row, 4).value = label;
      sheet.getCell(row, 5).value = {
        formula: cells.length ? `SUM(${cells.join(",")})` : "0",
        result: transfers.reduce((sum, transfer) => sum + transfer.total, 0),
      };
      sheet.getCell(row, 5).numFmt = MONEY;
    });
    sheet.headerFooter.oddFooter = "Acropora OS - GLS elszámolás";

    const invoiceSheet = workbook.addWorksheet("GLS számlák", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    });
    invoiceSheet.columns = [
      { header: "Kelte", key: "invoiceDate", width: 14 },
      { header: "GLS számlaszám", key: "invoiceNumber", width: 18 },
      { header: "Csomag", key: "parcelCount", width: 10 },
      { header: "Díj", key: "feeTotal", width: 16 },
      { header: "Kártyadíj", key: "cardFeeTotal", width: 16 },
      { header: "Összesen", key: "total", width: 16 },
    ];
    const invoices = [...invoiceSource].sort(
      (a, b) =>
        (a.invoiceDate?.getTime() ?? 0) - (b.invoiceDate?.getTime() ?? 0) ||
        a.invoiceNumber.localeCompare(b.invoiceNumber, "hu"),
    );
    invoices.forEach((invoice, index) => {
      const row = index + 2;
      invoiceSheet.addRow({
        ...invoice,
        total: {
          formula: `D${row}+E${row}`,
          result: invoice.feeTotal + invoice.cardFeeTotal,
        },
      });
    });
    if (invoices.length === 0)
      invoiceSheet.addRow({
        invoiceNumber: "Nincs GLS számla ebben a hónapban.",
      });
    invoiceSheet.getColumn("invoiceDate").numFmt = "yyyy-mm-dd";
    for (const key of ["feeTotal", "cardFeeTotal", "total"])
      invoiceSheet.getColumn(key).numFmt = MONEY;
    headerRow(invoiceSheet);

    const reviewSheet = workbook.addWorksheet("Ellenőrzendő tételek", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    });
    reviewSheet.columns = [
      { header: "Utalás napja", key: "transferDate", width: 14 },
      { header: "Fájl", key: "fileName", width: 36 },
      { header: "Forrás sor", key: "rowNumber", width: 11 },
      { header: "Csomagszám", key: "parcelNumber", width: 16 },
      { header: "Utánvét-hivatkozás", key: "codReference", width: 24 },
      { header: "Összeg", key: "amount", width: 14 },
      { header: "Ok", key: "reason", width: 34 },
    ];
    const open = transfers.flatMap((transfer) =>
      transfer.unresolvedLines.map((line) => ({
        transferDate: transfer.transferDate,
        fileName: transfer.fileName,
        ...line,
      })),
    );
    for (const line of open) reviewSheet.addRow(line);
    if (open.length === 0)
      reviewSheet.addRow({ transferDate: "Nincs ellenőrzendő tétel." });
    reviewSheet.getColumn("transferDate").numFmt = "yyyy-mm-dd";
    reviewSheet.getColumn("amount").numFmt = MONEY;
    headerRow(reviewSheet);

    return {
      filename: `gls-${year}-${String(month).padStart(2, "0")}.xlsx`,
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
}
