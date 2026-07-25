var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
const SHEET_NAME = "Leltár";
const HEADERS = [
    "Cikkszám",
    "Termék",
    "Jelenlegi mennyiség",
    "Leltározott mennyiség",
];
const text = (value) => String(value ?? "").trim();
const key = (value) => text(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
let InventoryCountXlsx = class InventoryCountXlsx {
    async buildTemplate(detail) {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(SHEET_NAME);
        sheet.addRow([...HEADERS]);
        sheet.getRow(1).font = { bold: true };
        for (const line of detail.lines) {
            const prefill = Number(line.countedQty ?? line.expectedQty);
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
        return (await workbook.xlsx.writeBuffer());
    }
    async parseUpload(buffer) {
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(buffer);
        }
        catch {
            throw new BadRequestException("A feltöltött fájl nem olvasható XLSX.");
        }
        const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
        if (!sheet) {
            throw new BadRequestException("A feltöltött fájl üres.");
        }
        const headerRow = sheet.getRow(1).values;
        const columnByKey = new Map();
        headerRow.forEach((header, column) => {
            if (!column || !text(header))
                return;
            columnByKey.set(key(header), column);
        });
        const skuColumn = columnByKey.get(key("Cikkszám")) ?? columnByKey.get("sku");
        const countedColumn = columnByKey.get(key("Leltározott mennyiség")) ??
            columnByKey.get(key("countedqty"));
        if (!skuColumn || !countedColumn) {
            throw new BadRequestException("A fájl kötelező oszlopai: Cikkszám és Leltározott mennyiség.");
        }
        const rows = [];
        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
            const source = sheet.getRow(rowNumber);
            const sku = text(source.getCell(skuColumn).value);
            const countedText = text(source.getCell(countedColumn).value);
            if (!sku && !countedText)
                continue;
            if (!sku) {
                throw new BadRequestException(`Érvénytelen sor (${rowNumber}. sor): hiányzik a cikkszám.`);
            }
            if (!countedText)
                continue;
            const countedQty = Number(countedText);
            if (!Number.isFinite(countedQty)) {
                throw new BadRequestException(`Érvénytelen sor (${rowNumber}. sor, ${sku}): a leltározott mennyiség nem szám.`);
            }
            rows.push({
                sku,
                countedQty: String(countedQty),
                sourceRowNumber: rowNumber,
            });
        }
        return { rows };
    }
};
InventoryCountXlsx = __decorate([
    Injectable()
], InventoryCountXlsx);
export { InventoryCountXlsx };
//# sourceMappingURL=inventory-count-xlsx.js.map