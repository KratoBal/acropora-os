import { Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";

export interface FoxpostReportSettlement {
  invoiceIssueDate: Date;
  settlementCode: string;
  foxpostInvoiceNumber: string;
  collectedAmount: number;
  invoiceGrossAmount: number;
  transferredAmount: number;
  invoiceNumbers: string[];
  unresolvedLines: FoxpostReportUnresolvedLine[];
}

export interface FoxpostReportUnresolvedLine {
  gmailMessageId: string;
  gmailSubject: string | null;
  sourceRowNumber: number;
  referenceCode: string;
  transactionDate: Date;
  recipientName: string | null;
  parcelBarcode: string | null;
  collectedAmount: number;
  status: "ORDER_NOT_FOUND" | "INVOICE_NOT_FOUND";
  errorCode: string | null;
}

export interface BuiltFoxpostMonthlyReport {
  filename: string;
  buffer: Buffer;
  settlementCount: number;
  invoiceCount: number;
  collectedAmount: number;
  invoiceGrossAmount: number;
  transferredAmount: number;
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function unresolvedStatusLabel(
  status: FoxpostReportUnresolvedLine["status"],
): string {
  return status === "ORDER_NOT_FOUND"
    ? "Rendelés nem található"
    : "Számla nem található";
}

@Injectable()
export class FoxpostMonthlyReportXlsx {
  async build(
    year: number,
    month: number,
    source: readonly FoxpostReportSettlement[],
  ): Promise<BuiltFoxpostMonthlyReport> {
    const settlements = [...source].sort(
      (left, right) =>
        left.invoiceIssueDate.getTime() - right.invoiceIssueDate.getTime() ||
        left.settlementCode.localeCompare(right.settlementCode, "hu"),
    );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Acropora OS";
    workbook.company = "Acropora Kft.";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("FOXPOST", {
      views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
      pageSetup: {
        orientation: "portrait",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        margins: {
          left: 0.45,
          right: 0.45,
          top: 0.55,
          bottom: 0.55,
          header: 0.2,
          footer: 0.2,
        },
      },
    });
    sheet.columns = [
      { key: "date", width: 15 },
      { key: "invoice", width: 25 },
      { key: "space", width: 3 },
      { key: "label", width: 14 },
      { key: "amount", width: 18 },
      { key: "foxpostInvoice", width: 20 },
    ];
    sheet.mergeCells("A1:F1");
    sheet.getCell("A1").value = "FOXPOST";
    sheet.getCell("A1").font = { name: "Aptos", size: 16, bold: true };
    sheet.getCell("A1").alignment = { vertical: "middle" };
    sheet.getRow(1).height = 24;
    sheet.mergeCells("A2:F2");
    sheet.getCell("A2").value = monthLabel(year, month);
    sheet.getCell("A2").font = {
      name: "Aptos",
      size: 10,
      color: { argb: "FF64748B" },
    };
    sheet.getRow(2).height = 19;

    let rowNumber = 4;
    const collectedCells: string[] = [];
    const invoiceCells: string[] = [];
    const transferredCells: string[] = [];
    for (const settlement of settlements) {
      const invoiceNumbers = [...new Set(settlement.invoiceNumbers)].sort(
        (a, b) => a.localeCompare(b, "hu", { numeric: true }),
      );
      const blockHeight = Math.max(3, invoiceNumbers.length);
      const firstRow = rowNumber;
      const secondRow = rowNumber + 1;
      const thirdRow = rowNumber + 2;
      sheet.getCell(firstRow, 1).value = settlement.invoiceIssueDate;
      sheet.getCell(firstRow, 1).numFmt = "yyyy-mm-dd";
      sheet.getCell(firstRow, 1).alignment = {
        horizontal: "left",
        vertical: "middle",
      };
      invoiceNumbers.forEach((invoiceNumber, index) => {
        sheet.getCell(firstRow + index, 2).value = invoiceNumber;
        sheet.getCell(firstRow + index, 2).alignment = {
          horizontal: "left",
          vertical: "middle",
          indent: 1,
        };
      });
      sheet.getCell(firstRow, 4).value = "Beszedett";
      sheet.getCell(firstRow, 5).value = settlement.collectedAmount;
      sheet.getCell(secondRow, 4).value = "Számla";
      sheet.getCell(secondRow, 5).value = settlement.invoiceGrossAmount;
      sheet.getCell(secondRow, 6).value = settlement.foxpostInvoiceNumber;
      sheet.getCell(secondRow, 6).alignment = {
        horizontal: "left",
        vertical: "middle",
        indent: 1,
      };
      sheet.getCell(thirdRow, 4).value = "Utalt";
      sheet.getCell(thirdRow, 5).value = {
        formula: `E${firstRow}-E${secondRow}`,
        result: settlement.transferredAmount,
      };
      collectedCells.push(`E${firstRow}`);
      invoiceCells.push(`E${secondRow}`);
      transferredCells.push(`E${thirdRow}`);

      for (
        let styledRow = firstRow;
        styledRow < firstRow + blockHeight;
        styledRow += 1
      ) {
        for (let column = 1; column <= 6; column += 1) {
          const cell = sheet.getCell(styledRow, column);
          cell.font = { name: "Aptos", size: 11, color: { argb: "FF0F172A" } };
          cell.alignment = { ...cell.alignment, vertical: "middle" };
          if (styledRow === firstRow)
            cell.border = {
              top: { style: "thin", color: { argb: "FFCBD5E1" } },
            };
        }
      }
      for (let summaryRow = firstRow; summaryRow <= thirdRow; summaryRow += 1) {
        sheet.getCell(summaryRow, 4).font = {
          name: "Aptos",
          size: 11,
          bold: true,
          color: { argb: "FF334155" },
        };
        sheet.getCell(summaryRow, 5).numFmt = '#,##0 "Ft"';
        sheet.getCell(summaryRow, 5).alignment = {
          horizontal: "right",
          vertical: "middle",
        };
      }
      rowNumber += blockHeight + 1;
    }

    const totalsRow = rowNumber + 1;
    sheet.getCell(totalsRow, 4).value = "Havi összesen";
    sheet.getCell(totalsRow, 4).font = { name: "Aptos", size: 11, bold: true };
    const totals = [
      [
        "Beszedett",
        collectedCells,
        settlements.reduce((sum, row) => sum + row.collectedAmount, 0),
      ],
      [
        "Számla",
        invoiceCells,
        settlements.reduce((sum, row) => sum + row.invoiceGrossAmount, 0),
      ],
      [
        "Utalt",
        transferredCells,
        settlements.reduce((sum, row) => sum + row.transferredAmount, 0),
      ],
    ] as const;
    totals.forEach(([label, cells, result], index) => {
      const row = totalsRow + 1 + index;
      sheet.getCell(row, 4).value = label;
      sheet.getCell(row, 5).value = {
        formula: cells.length ? `SUM(${cells.join(",")})` : "0",
        result,
      };
      sheet.getCell(row, 5).numFmt = '#,##0 "Ft"';
    });
    for (
      let styledRow = totalsRow;
      styledRow <= totalsRow + 3;
      styledRow += 1
    ) {
      for (let column = 4; column <= 5; column += 1) {
        const cell = sheet.getCell(styledRow, column);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF1F5F9" },
        };
        cell.border = {
          top: { style: "thin", color: { argb: "FF94A3B8" } },
          bottom: { style: "thin", color: { argb: "FF94A3B8" } },
          left: { style: "thin", color: { argb: "FF94A3B8" } },
          right: { style: "thin", color: { argb: "FF94A3B8" } },
        };
        cell.font = { name: "Aptos", size: 11, color: { argb: "FF0F172A" } };
      }
    }
    sheet.headerFooter.oddFooter = "Acropora OS - Foxpost elszámolás";
    sheet.headerFooter.oddHeader = `${year}-${String(month).padStart(2, "0")}`;

    const reviewSheet = workbook.addWorksheet("Ellenőrzendő tételek", {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    reviewSheet.columns = [
      { header: "Elszámolás", key: "settlementCode", width: 14 },
      { header: "Foxpost számla", key: "foxpostInvoiceNumber", width: 20 },
      { header: "Gmail üzenet ID", key: "gmailMessageId", width: 24 },
      { header: "Gmail tárgy", key: "gmailSubject", width: 34 },
      { header: "Forrás sor", key: "sourceRowNumber", width: 12 },
      { header: "Referencia kód", key: "referenceCode", width: 24 },
      { header: "Tranzakció", key: "transactionDate", width: 14 },
      { header: "Címzett", key: "recipientName", width: 26 },
      { header: "Vonalkód", key: "parcelBarcode", width: 22 },
      { header: "Beszedett", key: "collectedAmount", width: 16 },
      { header: "Állapot", key: "status", width: 24 },
      { header: "Hibakód", key: "errorCode", width: 34 },
    ];
    const unresolvedRows = settlements.flatMap((settlement) =>
      settlement.unresolvedLines.map((line) => ({
        settlementCode: settlement.settlementCode,
        foxpostInvoiceNumber: settlement.foxpostInvoiceNumber,
        ...line,
        status: unresolvedStatusLabel(line.status),
      })),
    );
    if (unresolvedRows.length) {
      for (const row of unresolvedRows) reviewSheet.addRow(row);
      reviewSheet.getColumn("transactionDate").numFmt = "yyyy-mm-dd";
      reviewSheet.getColumn("collectedAmount").numFmt = '#,##0 "Ft"';
      reviewSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: unresolvedRows.length + 1, column: 12 },
      };
    } else {
      reviewSheet.addRow({
        settlementCode: "Nincs ellenőrzendő tétel.",
      });
      reviewSheet.mergeCells("A2:L2");
    }
    reviewSheet.getRow(1).font = {
      name: "Aptos",
      size: 10,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    reviewSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF334155" },
    };
    reviewSheet.getRow(1).alignment = { vertical: "middle" };
    reviewSheet.getRow(1).height = 22;
    for (let row = 2; row <= reviewSheet.rowCount; row += 1) {
      reviewSheet.getRow(row).font = {
        name: "Aptos",
        size: 10,
        color: { argb: "FF0F172A" },
      };
      reviewSheet.getRow(row).alignment = {
        vertical: "middle",
        wrapText: true,
      };
      reviewSheet.getRow(row).height = 30;
    }
    reviewSheet.headerFooter.oddFooter =
      "Acropora OS - kézi ellenőrzést igénylő Foxpost tételek";

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: `foxpost-${year}-${String(month).padStart(2, "0")}.xlsx`,
      buffer,
      settlementCount: settlements.length,
      invoiceCount: settlements.reduce(
        (sum, settlement) => sum + new Set(settlement.invoiceNumbers).size,
        0,
      ),
      collectedAmount: settlements.reduce(
        (sum, settlement) => sum + settlement.collectedAmount,
        0,
      ),
      invoiceGrossAmount: settlements.reduce(
        (sum, settlement) => sum + settlement.invoiceGrossAmount,
        0,
      ),
      transferredAmount: settlements.reduce(
        (sum, settlement) => sum + settlement.transferredAmount,
        0,
      ),
    };
  }
}
