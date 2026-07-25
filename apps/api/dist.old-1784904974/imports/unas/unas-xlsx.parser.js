var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
const text = (value) => String(value ?? "").trim();
const splitList = (value) => text(value)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
const splitImages = (value) => text(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
const categoryPath = (value) => text(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("|");
const key = (value) => text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
function pick(row, ...aliases) {
    for (const alias of aliases) {
        const value = row[key(alias)];
        if (value !== undefined && text(value))
            return value;
    }
    return undefined;
}
function rowsOf(sheet) {
    const headers = sheet.getRow(1).values;
    const rows = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const source = sheet.getRow(rowNumber);
        const raw = { sourceRowNumber: rowNumber };
        headers.forEach((header, column) => {
            if (!column || !text(header))
                return;
            const value = source.getCell(column).value;
            raw[key(header)] =
                typeof value === "object" && value && "text" in value
                    ? value.text
                    : value;
        });
        if (Object.entries(raw).some(([field, value]) => field !== "sourceRowNumber" && text(value)))
            rows.push(raw);
    }
    return rows;
}
let UnasXlsxParser = class UnasXlsxParser {
    async parse(buffer) {
        const workbook = new ExcelJS.Workbook();
        try {
            await workbook.xlsx.load(buffer);
        }
        catch {
            throw new BadRequestException("A feltöltött fájl nem olvasható XLSX.");
        }
        const productsSheet = workbook.getWorksheet("Products");
        const categoriesSheet = workbook.getWorksheet("Categories");
        if (!productsSheet || !categoriesSheet) {
            throw new BadRequestException("Az XLSX kötelező munkalapjai: Products és Categories.");
        }
        const categoryRows = rowsOf(categoriesSheet).map((raw) => ({
            raw,
            externalId: text(pick(raw, "externalId", "id", "categoryId", "Azonosító")),
            name: text(pick(raw, "name", "categoryName", "Kategória neve")),
            parentPath: categoryPath(pick(raw, "parentId", "parentExternalId", "Szülő kategória")),
        }));
        const categoryIdByPath = new Map(categoryRows.map((category) => [
            categoryPath([category.parentPath, category.name].filter(Boolean).join("|")),
            category.externalId,
        ]));
        const categoryPathById = new Map([...categoryIdByPath].map(([path, id]) => [id, path]));
        const resolveCategory = (value) => {
            const reference = categoryPath(value);
            return (categoryIdByPath.get(reference) ?? reference) || undefined;
        };
        const products = rowsOf(productsSheet).map((raw) => ({
            sourceRowNumber: Number(raw.sourceRowNumber),
            externalId: text(pick(raw, "externalId", "id")) || undefined,
            sku: text(pick(raw, "sku", "stockKeepingUnit", "Cikkszám")),
            name: text(pick(raw, "name", "title", "productName", "Termék Név")),
            description: text(pick(raw, "description", "Rövid Leírás")) || undefined,
            externalStatus: text(pick(raw, "status", "externalStatus", "Státusz")) || undefined,
            primaryCategoryExternalId: resolveCategory(pick(raw, "categoryId", "primaryCategoryId", "Kategória")),
            primaryCategoryPath: categoryPath(pick(raw, "Kategória")) || undefined,
            alternativeCategoryExternalIds: splitList(pick(raw, "alternativeCategoryIds", "categories", "Kiegészítő Kategóriák")),
            alternativeCategoryPaths: splitList(pick(raw, "alternativeCategoryIds", "categories", "Kiegészítő Kategóriák")).map((id) => categoryPathById.get(id) ?? id),
            brandName: text(pick(raw, "brand", "manufacturer", "Paraméter: brand||text")) ||
                undefined,
            manufacturerPartNumber: text(pick(raw, "manufacturerPartNumber", "mpn", "Paraméter: gyártói cikkszám||text")) || undefined,
            imageUrls: splitImages(pick(raw, "images", "imageUrls", "image", "Kép link")),
            isActive: pick(raw, "active", "isActive") === undefined
                ? undefined
                : ["1", "true", "yes", "igen"].includes(text(pick(raw, "active", "isActive")).toLowerCase()),
            rawPayload: raw,
        }));
        const categories = categoryRows.map(({ raw, externalId, name, parentPath }) => ({
            sourceRowNumber: Number(raw.sourceRowNumber),
            externalId,
            name,
            parentExternalId: parentPath
                ? (categoryIdByPath.get(parentPath) ?? parentPath)
                : undefined,
            rawPayload: raw,
        }));
        const brandsSheet = workbook.getWorksheet("Brands");
        const brands = brandsSheet
            ? rowsOf(brandsSheet).map((raw) => ({
                sourceRowNumber: Number(raw.sourceRowNumber),
                externalId: text(pick(raw, "externalId", "id")) || undefined,
                name: text(pick(raw, "name", "brand", "manufacturer")),
                rawPayload: raw,
            }))
            : [];
        return { products, categories, brands };
    }
};
UnasXlsxParser = __decorate([
    Injectable()
], UnasXlsxParser);
export { UnasXlsxParser };
//# sourceMappingURL=unas-xlsx.parser.js.map