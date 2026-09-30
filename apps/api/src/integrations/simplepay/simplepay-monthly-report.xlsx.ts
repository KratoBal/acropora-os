import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

/**
 * THE MONTHLY SIMPLEPAY FILE, in the shape of Luca's hand-made table
 * (exchange/simplepay/Simple_majus_2026-luca-kezi.xlsx, the model Balázs
 * pointed at: "Luca manuálisan ilyen táblázatot gyárt").
 *
 * Her table, read cell by cell: one block per weekly report, its date in the
 * first column, the outgoing invoice numbers the week's payments paid under
 * it, and beside them three figures: Összesen, Jutalék, Utalt. A payment
 * whose order has no invoice yet stands in the invoice column as its own
 * line ("30.467FT még nem teljesített rendelés"). This file keeps all of that,
 * and puts what still needs a person on a sheet of its own.
 *
 * The month is the report's day (the report_YYYYMMDD.csv date, when SimplePay
 * sent it). Built at every download from what is stored, so it never lags a
 * decision.
 */

export interface SimplePayReportBlock {
  /** The report's day; null when its file name did not carry one. */
  reportDate: Date | null;
  fileName: string;
  amountTotal: number;
  commissionTotal: number;
  netTotal: number;
  /** The invoice numbers the resolved payments paid. */
  invoiceNumbers: string[];
  /** Payments whose order has no invoice yet: Luca's "még nem teljesített". */
  notInvoiced: Array<{ amount: number; orderNumber: string | null }>;
  /** Payments that need a person, for the review sheet. */
  review: Array<{
    merchantTransactionId: string;
    transactionAt: string;
    amount: number;
    orderNumber: string | null;
    reason: string;
  }>;
}

const FONT = "Aptos";
const MONEY = '#,##0 "Ft"';

/**
 * "140 140" with a plain space: Intl puts a no-break space between the digit
 * groups, and a cell text with it is not found by a search typed in Excel.
 */
const forint = (value: number) =>
  new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 })
    .format(value)
    .replace(/\u00a0/g, " ");

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
export class SimplePayMonthlyReportXlsx {
  async build(
    year: number,
    month: number,
    source: readonly SimplePayReportBlock[],
  ): Promise<{ filename: string; buffer: Buffer }> {
    const blocks = [...source].sort(
      (a, b) =>
        (a.reportDate?.getTime() ?? 0) - (b.reportDate?.getTime() ?? 0) ||
        a.fileName.localeCompare(b.fileName, "hu"),
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Acropora OS";
    workbook.company = "Acropora Kft.";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("SimplePay", {
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
      { key: "date", width: 14 },
      { key: "invoice", width: 44 },
      { key: "space", width: 3 },
      { key: "label", width: 12 },
      { key: "amount", width: 16 },
    ];
    sheet.mergeCells("A1:E1");
    sheet.getCell("A1").value = "SimplePay";
    sheet.getCell("A1").font = { name: FONT, size: 16, bold: true };
    sheet.mergeCells("A2:E2");
    sheet.getCell("A2").value = monthLabel(year, month);
    sheet.getCell("A2").font = {
      name: FONT,
      size: 10,
      color: { argb: "FF64748B" },
    };

    let rowNumber = 4;
    const cells = {
      total: [] as string[],
      commission: [] as string[],
      net: [] as string[],
    };
    for (const block of blocks) {
      const invoiceColumn = [
        ...[...new Set(block.invoiceNumbers)].sort((a, b) =>
          a.localeCompare(b, "hu", { numeric: true }),
        ),
        // her own wording, with the order it belongs to
        ...block.notInvoiced.map(
          (payment) =>
            `${forint(payment.amount)} Ft még nem teljesített rendelés${
              payment.orderNumber ? ` (${payment.orderNumber})` : ""
            }`,
        ),
        ...(block.review.length > block.notInvoiced.length
          ? [
              `${block.review.length - block.notInvoiced.length} fizetés ellenőrzendő (külön lapon)`,
            ]
          : []),
      ];
      const first = rowNumber;
      const height = Math.max(3, invoiceColumn.length);
      if (block.reportDate) {
        sheet.getCell(first, 1).value = block.reportDate;
        sheet.getCell(first, 1).numFmt = "yyyy-mm-dd";
      } else sheet.getCell(first, 1).value = block.fileName;
      invoiceColumn.forEach((text, index) => {
        sheet.getCell(first + index, 2).value = text;
      });
      sheet.getCell(first, 4).value = "Összesen";
      sheet.getCell(first, 5).value = block.amountTotal;
      sheet.getCell(first + 1, 4).value = "Jutalék";
      sheet.getCell(first + 1, 5).value = block.commissionTotal;
      sheet.getCell(first + 2, 4).value = "Utalt";
      // SimplePay's own net figure, not a formula: it is what arrived
      sheet.getCell(first + 2, 5).value = block.netTotal;
      cells.total.push(`E${first}`);
      cells.commission.push(`E${first + 1}`);
      cells.net.push(`E${first + 2}`);
      for (let row = first; row < first + height; row++)
        for (let column = 1; column <= 5; column++) {
          const cell = sheet.getCell(row, column);
          cell.font = { name: FONT, size: 11, bold: column === 4 };
          if (column === 5) cell.numFmt = MONEY;
          if (row === first)
            cell.border = {
              top: { style: "thin", color: { argb: "FFCBD5E1" } },
            };
        }
      rowNumber += height + 1;
    }

    const totalsRow = rowNumber + 1;
    sheet.getCell(totalsRow, 4).value = "Havi összesen";
    sheet.getCell(totalsRow, 4).font = { name: FONT, size: 11, bold: true };
    (
      [
        [
          "Összesen",
          cells.total,
          blocks.reduce((s, b) => s + b.amountTotal, 0),
        ],
        [
          "Jutalék",
          cells.commission,
          blocks.reduce((s, b) => s + b.commissionTotal, 0),
        ],
        ["Utalt", cells.net, blocks.reduce((s, b) => s + b.netTotal, 0)],
      ] as const
    ).forEach(([label, refs, result], index) => {
      const row = totalsRow + 1 + index;
      sheet.getCell(row, 4).value = label;
      sheet.getCell(row, 5).value = {
        formula: refs.length ? `SUM(${refs.join(",")})` : "0",
        result,
      };
      sheet.getCell(row, 5).numFmt = MONEY;
    });
    if (blocks.length === 0)
      sheet.getCell(4, 2).value = "Ebben a hónapban nincs SimplePay kimutatás.";
    sheet.headerFooter.oddFooter = "Acropora OS - SimplePay elszámolás";

    const reviewSheet = workbook.addWorksheet("Ellenőrzendő fizetések", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    });
    reviewSheet.columns = [
      { header: "Kimutatás", key: "report", width: 14 },
      { header: "Tranzakció", key: "merchantTransactionId", width: 20 },
      { header: "Időpont", key: "transactionAt", width: 20 },
      { header: "Összeg", key: "amount", width: 14 },
      { header: "Rendelés", key: "orderNumber", width: 22 },
      { header: "Ok", key: "reason", width: 44 },
    ];
    const open = blocks.flatMap((block) =>
      block.review.map((payment) => ({
        report: block.reportDate ?? block.fileName,
        ...payment,
      })),
    );
    for (const payment of open) reviewSheet.addRow(payment);
    if (open.length === 0)
      reviewSheet.addRow({ report: "Nincs ellenőrzendő fizetés." });
    reviewSheet.getColumn("report").numFmt = "yyyy-mm-dd";
    reviewSheet.getColumn("amount").numFmt = MONEY;
    headerRow(reviewSheet);

    return {
      filename: `simplepay-${year}-${String(month).padStart(2, "0")}.xlsx`,
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }
}
