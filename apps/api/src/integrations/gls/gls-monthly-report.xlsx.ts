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
 *   - GLS does not take its fee from the transfer as a deduction line (the
 *     invoice attachments' bank-fee sheet is empty), BUT on the day of a
 *     transfer it may set its own open invoices against the COD and transfer
 *     only the rest, and says so in a compensation letter (measured
 *     2026-09-29 on three letters; the earlier "Utalt = Beszedett" here was
 *     wrong for those days). So a block reads: Beszedett, Kompenzáció, Utalt =
 *     Beszedett - Kompenzáció, and a check against the letter. A day with no
 *     letter says so instead of claiming there was none. The fee invoices of
 *     the month stand on their own sheet, by invoice date.
 *
 * Built at every download from what is stored, so it never lags a decision.
 */

export interface GlsReportTransfer {
  transferDate: Date;
  fileName: string;
  total: number;
  invoiceNumbers: string[];
  unresolvedLines: GlsReportUnresolvedLine[];
  /** The compensation letter of the same day, if one is in. */
  compensation: GlsReportCompensation | null;
}

export interface GlsReportCompensation {
  date: Date;
  fileName: string;
  /** What the letter says was collected: must equal the COD report's total. */
  cod: number;
  compensated: number;
  transferred: number;
  /** The GLS invoices set off. */
  references: string[];
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

const money = (value: number) =>
  `${new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 }).format(value)} Ft`;
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
    /** Letters with no COD report on their day: they go to the review sheet. */
    unpairedCompensations: readonly GlsReportCompensation[] = [],
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
      { key: "check", width: 48 },
    ];
    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "GLS";
    sheet.getCell("A1").font = { name: FONT, size: 16, bold: true };
    sheet.mergeCells("A2:F2");
    sheet.getCell("A2").value = monthLabel(year, month);
    sheet.getCell("A2").font = {
      name: FONT,
      size: 10,
      color: { argb: "FF64748B" },
    };

    let rowNumber = 4;
    const collectedCells: string[] = [];
    const compensatedCells: string[] = [];
    const transferredCells: string[] = [];
    const mismatches: Array<{ transfer: GlsReportTransfer; reason: string }> =
      [];
    for (const transfer of transfers) {
      const invoiceNumbers = [...new Set(transfer.invoiceNumbers)].sort(
        (a, b) => a.localeCompare(b, "hu", { numeric: true }),
      );
      const blockHeight = Math.max(3, invoiceNumbers.length);
      const first = rowNumber;
      const compensation = transfer.compensation;
      const compensated = compensation?.compensated ?? 0;
      sheet.getCell(first, 1).value = transfer.transferDate;
      sheet.getCell(first, 1).numFmt = "yyyy-mm-dd";
      invoiceNumbers.forEach((invoiceNumber, index) => {
        sheet.getCell(first + index, 2).value = invoiceNumber;
      });
      sheet.getCell(first, 4).value = "Beszedett";
      sheet.getCell(first, 5).value = transfer.total;
      sheet.getCell(first + 1, 4).value = "Kompenzáció";
      sheet.getCell(first + 1, 5).value = compensated;
      sheet.getCell(first + 2, 4).value = "Utalt";
      sheet.getCell(first + 2, 5).value = {
        formula: `E${first}-E${first + 1}`,
        result: transfer.total - compensated,
      };
      let check: string;
      if (!compensation) check = "Erre a napra nincs kompenzációs értesítő.";
      else if (compensation.cod !== transfer.total) {
        check = `ELTÉRÉS: az értesítő szerint beszedett ${money(compensation.cod)}, a részletező szerint ${money(transfer.total)}.`;
        mismatches.push({ transfer, reason: check });
      } else
        check = `Egyezik az értesítővel: ${money(compensation.cod)} - ${money(compensated)} = ${money(compensation.transferred)}.`;
      sheet.getCell(first + 2, 6).value = check;
      if (compensation?.references.length)
        sheet.getCell(first + 1, 6).value =
          `GLS számla: ${compensation.references.join(", ")}`;
      collectedCells.push(`E${first}`);
      compensatedCells.push(`E${first + 1}`);
      transferredCells.push(`E${first + 2}`);
      for (let row = first; row < first + blockHeight; row++)
        for (let column = 1; column <= 6; column++) {
          const cell = sheet.getCell(row, column);
          cell.font = {
            name: FONT,
            size: column === 6 ? 9 : 11,
            bold: column === 4,
            ...(column === 6 && check.startsWith("ELTÉRÉS")
              ? { color: { argb: "FFB91C1C" } }
              : {}),
          };
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
    const collected = transfers.reduce(
      (sum, transfer) => sum + transfer.total,
      0,
    );
    const compensatedTotal = transfers.reduce(
      (sum, transfer) => sum + (transfer.compensation?.compensated ?? 0),
      0,
    );
    (
      [
        ["Beszedett", collectedCells, collected],
        ["Kompenzáció", compensatedCells, compensatedTotal],
        ["Utalt", transferredCells, collected - compensatedTotal],
      ] as const
    ).forEach(([label, cells, result], index) => {
      const row = totalsRow + 1 + index;
      sheet.getCell(row, 4).value = label;
      sheet.getCell(row, 5).value = {
        formula: cells.length ? `SUM(${cells.join(",")})` : "0",
        result,
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
      { header: "Ok", key: "reason", width: 60 },
    ];
    const open = transfers.flatMap((transfer) =>
      transfer.unresolvedLines.map((line) => ({
        transferDate: transfer.transferDate,
        fileName: transfer.fileName,
        ...line,
      })),
    );
    for (const line of open) reviewSheet.addRow(line);
    for (const { transfer, reason } of mismatches)
      reviewSheet.addRow({
        transferDate: transfer.transferDate,
        fileName: transfer.compensation!.fileName,
        amount: transfer.compensation!.cod,
        reason,
      });
    for (const letter of unpairedCompensations)
      reviewSheet.addRow({
        transferDate: letter.date,
        fileName: letter.fileName,
        amount: letter.compensated,
        reason:
          "Kompenzációs értesítő, de erre a napra nincs utánvét-részletező",
      });
    if (open.length + mismatches.length + unpairedCompensations.length === 0)
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
