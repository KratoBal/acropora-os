import ExcelJS from "exceljs";
import {
  MISSING_INVOICE_CATEGORY_LABELS,
  MISSING_INVOICE_STATE_LABELS,
  type MissingInvoiceItem,
} from "@acropora/types";

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A hiánylista egy sora: a tétel, és a párosított vagy jelölt számlák száma. */
export interface MissingInvoicesXlsxRow {
  item: MissingInvoiceItem;
  invoiceNumbers: readonly string[];
}

/** A hiánylista oszlopai (brief 13. pont). */
const COLUMNS = [
  { header: "Dátum", width: 12 },
  { header: "Bankszámla", width: 22 },
  { header: "Partner", width: 32 },
  { header: "Közlemény", width: 44 },
  { header: "Összeg", width: 14 },
  { header: "Pénznem", width: 9 },
  { header: "Eredeti összeg", width: 14 },
  { header: "Eredeti deviza", width: 9 },
  { header: "Kategória", width: 20 },
  { header: "Állapot", width: 18 },
  { header: "Megjegyzés", width: 36 },
  { header: "Számla száma", width: 28 },
  { header: "Hiányzó számla", width: 28 },
  { header: "Összeg-eltérés", width: 16 },
] as const;

/**
 * A HÓNAP PROBLÉMÁS TÉTELEI A KÖNYVELŐNEK. Az összeg SZÁM a cellában, nem
 * szöveg: a könyvelő összegezni és szűrni akar rá, és egy szövegként tárolt
 * szám az Excelben csendben kimarad a SZUM-ból.
 */
export async function buildMissingInvoicesXlsx(
  month: string,
  rows: readonly MissingInvoicesXlsxRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Hiányzó számlák ${month}`);
  sheet.columns = COLUMNS.map((column) => ({ ...column }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const { item, invoiceNumbers } of rows)
    sheet.addRow([
      item.bookingDate,
      item.account.name,
      item.partner ?? "",
      item.narrative,
      Number(item.amount),
      item.currency,
      item.original ? Number(item.original.amount) : null,
      item.original?.currency ?? "",
      MISSING_INVOICE_CATEGORY_LABELS[item.category],
      MISSING_INVOICE_STATE_LABELS[item.state],
      item.comment ?? "",
      invoiceNumbers.join(", "),
      // név szerint, ahogy a felület is (acrobot 25610)
      item.missingNumbers.join(", "),
      item.amountDifference
        ? `${item.amountDifference.amount} ${item.amountDifference.currency}`
        : "",
    ]);
  for (const key of [5, 7]) sheet.getColumn(key).numFmt = "#,##0.##";
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
