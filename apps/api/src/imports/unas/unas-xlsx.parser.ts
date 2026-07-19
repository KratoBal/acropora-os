import { BadRequestException, Injectable } from "@nestjs/common";
import ExcelJS from "exceljs";
import type {
  UnasBrandImportRow,
  UnasCategoryImportRow,
  UnasParsedWorkbook,
  UnasProductImportRow,
} from "@acropora/types";

type RawRow = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const splitList = (value: unknown) =>
  text(value)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
const splitImages = (value: unknown) =>
  text(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
const categoryPath = (value: unknown) =>
  text(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("|");
const key = (value: unknown) =>
  text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

function pick(row: RawRow, ...aliases: string[]) {
  for (const alias of aliases) {
    const value = row[key(alias)];
    if (value !== undefined && text(value)) return value;
  }
  return undefined;
}

function rowsOf(sheet: ExcelJS.Worksheet): RawRow[] {
  const headers = sheet.getRow(1).values as ExcelJS.CellValue[];
  const rows: RawRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const source = sheet.getRow(rowNumber);
    const raw: RawRow = { sourceRowNumber: rowNumber };
    headers.forEach((header, column) => {
      if (!column || !text(header)) return;
      const value = source.getCell(column).value;
      raw[key(header)] =
        typeof value === "object" && value && "text" in value
          ? value.text
          : value;
    });
    if (
      Object.entries(raw).some(
        ([field, value]) => field !== "sourceRowNumber" && text(value),
      )
    )
      rows.push(raw);
  }
  return rows;
}

@Injectable()
export class UnasXlsxParser {
  async parse(buffer: Buffer): Promise<UnasParsedWorkbook> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException("A feltöltött fájl nem olvasható XLSX.");
    }
    const productsSheet = workbook.getWorksheet("Products");
    const categoriesSheet = workbook.getWorksheet("Categories");
    if (!productsSheet || !categoriesSheet) {
      throw new BadRequestException(
        "Az XLSX kötelező munkalapjai: Products és Categories.",
      );
    }

    const categoryRows = rowsOf(categoriesSheet).map((raw) => ({
      raw,
      externalId: text(
        pick(raw, "externalId", "id", "categoryId", "Azonosító"),
      ),
      name: text(pick(raw, "name", "categoryName", "Kategória neve")),
      parentPath: categoryPath(
        pick(raw, "parentId", "parentExternalId", "Szülő kategória"),
      ),
    }));
    const categoryIdByPath = new Map(
      categoryRows.map((category) => [
        categoryPath(
          [category.parentPath, category.name].filter(Boolean).join("|"),
        ),
        category.externalId,
      ]),
    );
    const resolveCategory = (value: unknown) => {
      const reference = categoryPath(value);
      return (categoryIdByPath.get(reference) ?? reference) || undefined;
    };

    const products: UnasProductImportRow[] = rowsOf(productsSheet).map(
      (raw) => ({
        sourceRowNumber: Number(raw.sourceRowNumber),
        externalId: text(pick(raw, "externalId", "id")) || undefined,
        sku: text(pick(raw, "sku", "stockKeepingUnit", "Cikkszám")),
        name: text(pick(raw, "name", "title", "productName", "Termék Név")),
        description:
          text(pick(raw, "description", "Rövid Leírás")) || undefined,
        externalStatus:
          text(pick(raw, "status", "externalStatus", "Státusz")) || undefined,
        primaryCategoryExternalId: resolveCategory(
          pick(raw, "categoryId", "primaryCategoryId", "Kategória"),
        ),
        alternativeCategoryExternalIds: splitList(
          pick(
            raw,
            "alternativeCategoryIds",
            "categories",
            "Kiegészítő Kategóriák",
          ),
        ),
        brandName:
          text(pick(raw, "brand", "manufacturer", "Paraméter: brand||text")) ||
          undefined,
        imageUrls: splitImages(
          pick(raw, "images", "imageUrls", "image", "Kép link"),
        ),
        isActive:
          pick(raw, "active", "isActive") === undefined
            ? undefined
            : ["1", "true", "yes", "igen"].includes(
                text(pick(raw, "active", "isActive")).toLowerCase(),
              ),
        rawPayload: raw,
      }),
    );
    const categories: UnasCategoryImportRow[] = categoryRows.map(
      ({ raw, externalId, name, parentPath }) => ({
        sourceRowNumber: Number(raw.sourceRowNumber),
        externalId,
        name,
        parentExternalId: parentPath
          ? (categoryIdByPath.get(parentPath) ?? parentPath)
          : undefined,
        rawPayload: raw,
      }),
    );
    const brandsSheet = workbook.getWorksheet("Brands");
    const brands: UnasBrandImportRow[] = brandsSheet
      ? rowsOf(brandsSheet).map((raw) => ({
          sourceRowNumber: Number(raw.sourceRowNumber),
          externalId: text(pick(raw, "externalId", "id")) || undefined,
          name: text(pick(raw, "name", "brand", "manufacturer")),
          rawPayload: raw,
        }))
      : [];
    return { products, categories, brands };
  }
}
