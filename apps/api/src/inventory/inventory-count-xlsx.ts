import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type { InventoryCountDetail } from "@acropora/types";

const SHEET_NAME = "Leltár";
const HEADERS = [
  "Cikkszám",
  "Termék",
  "Jelenlegi mennyiség",
  "Leltározott mennyiség",
] as const;

const text = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) =>
  text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

export interface InventoryCountUploadRow {
  sku: string;
  countedQty: string;
  sourceRowNumber: number;
}

export interface InventoryCountUploadParseResult {
  rows: InventoryCountUploadRow[];
}

@Injectable()
export class InventoryCountXlsx {
  async buildTemplate(detail: InventoryCountDetail): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.addRow([...HEADERS]);
    sheet.getRow(1).font = { bold: true };
    for (const line of detail.lines) {
      // The counted column starts at 0, not at the expected quantity
      // (Balázs, 2026-10-07 05:48 UTC: „legyen minden tételnél 0 a
      // leltárívén”, card 49db3012). Pre-filling it with the expected stock
      // made an uncounted row look counted: it came back as a match, and a
      // missed shelf was confirmed silently. Now a row nobody counted comes
      // back as 0, so what is left out becomes zero stock on correction.
      // A count uploaded earlier (a re-download after a partial upload) is a
      // real count and is kept, a 0 included.
      const prefill = line.countedQty !== null ? Number(line.countedQty) : 0;
      sheet.addRow([
        line.sku,
        line.productName,
        Number(line.expectedQty),
        prefill,
      ]);
    }
    sheet.columns.forEach((column) => {
      column.width = 24;
    });
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async parseUpload(buffer: Buffer): Promise<InventoryCountUploadParseResult> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("A feltöltött fájl nem olvasható XLSX.");
    }
    const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException("A feltöltött fájl üres.");
    }

    const headerRow = sheet.getRow(1).values as ExcelJS.CellValue[];
    const columnByKey = new Map<string, number>();
    headerRow.forEach((header, column) => {
      if (!column || !text(header)) return;
      columnByKey.set(key(header), column);
    });
    const skuColumn =
      columnByKey.get(key("Cikkszám")) ?? columnByKey.get("sku");
    const countedColumn =
      columnByKey.get(key("Leltározott mennyiség")) ??
      columnByKey.get(key("countedqty"));
    if (!skuColumn || !countedColumn) {
      throw new BadRequestException(
        "A fájl kötelező oszlopai: Cikkszám és Leltározott mennyiség.",
      );
    }

    const rows: InventoryCountUploadRow[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const source = sheet.getRow(rowNumber);
      const sku = text(source.getCell(skuColumn).value);
      const countedText = text(source.getCell(countedColumn).value);
      if (!sku && !countedText) continue;
      if (!sku) {
        throw new BadRequestException(
          `Érvénytelen sor (${rowNumber}. sor): hiányzik a cikkszám.`,
        );
      }
      // A blank "Leltározott mennyiség" cell means the row wasn't counted at
      // all — it must NOT be coerced to 0 (Number(null) === 0), or an
      // untouched/accidentally cleared cell would zero out that product's
      // stock on correction. Skip it here so the line keeps its previous
      // (possibly still-unset) countedQty and shows up as still pending.
      if (!countedText) continue;
      const countedQty = Number(countedText);
      if (!Number.isFinite(countedQty)) {
        throw new BadRequestException(
          `Érvénytelen sor (${rowNumber}. sor, ${sku}): a leltározott mennyiség nem szám.`,
        );
      }
      rows.push({
        sku,
        countedQty: String(countedQty),
        sourceRowNumber: rowNumber,
      });
    }
    return { rows };
  }
}
