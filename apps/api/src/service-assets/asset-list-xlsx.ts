import ExcelJS from "exceljs";
import {
  ASSET_EXPORT_HEADERS,
  assetExportCells,
  type AssetListItem,
} from "@acropora/types";

/** Az oszlopszélességek, az `ASSET_EXPORT_HEADERS` sorrendjében. */
const WIDTHS = [36, 16, 14, 18, 30, 40, 34, 26, 22, 18, 18, 16];

/**
 * AZ ESZKÖZLISTA EXCELJE (kártya 323e9b38): a szűrt teljes halmaz, a lista
 * sorrendjében. A minta a Hiányzó számlák hiánylistája (`exceljs`, félkövér,
 * rögzített fejléc); új könyvtár nincs.
 */
export async function buildAssetListXlsx(
  items: readonly AssetListItem[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Eszközök");
  sheet.columns = ASSET_EXPORT_HEADERS.map((header, index) => ({
    header,
    width: WIDTHS[index] ?? 18,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ASSET_EXPORT_HEADERS.length },
  };
  for (const item of items) sheet.addRow(assetExportCells(item));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
