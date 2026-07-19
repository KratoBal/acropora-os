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
const split = (value: unknown) =>
  text(value)
    .split(/[|;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

    const products: UnasProductImportRow[] = rowsOf(productsSheet).map(
      (raw) => ({
        sourceRowNumber: Number(raw.sourceRowNumber),
        externalId: text(pick(raw, "externalId", "id")) || undefined,
        sku: text(pick(raw, "sku", "stockKeepingUnit")),
        name: text(pick(raw, "name", "title", "productName")),
        description: text(pick(raw, "description")) || undefined,
        externalStatus:
          text(pick(raw, "status", "externalStatus")) || undefined,
        primaryCategoryExternalId:
          text(pick(raw, "categoryId", "primaryCategoryId")) || undefined,
        alternativeCategoryExternalIds: split(
          pick(raw, "alternativeCategoryIds", "categories"),
        ),
        brandName: text(pick(raw, "brand", "manufacturer")) || undefined,
        imageUrls: split(pick(raw, "images", "imageUrls", "image")),
        isActive:
          pick(raw, "active", "isActive") === undefined
            ? undefined
            : ["1", "true", "yes", "igen"].includes(
                text(pick(raw, "active", "isActive")).toLowerCase(),
              ),
        rawPayload: raw,
      }),
    );
    const categories: UnasCategoryImportRow[] = rowsOf(categoriesSheet).map(
      (raw) => ({
        sourceRowNumber: Number(raw.sourceRowNumber),
        externalId: text(pick(raw, "externalId", "id", "categoryId")),
        name: text(pick(raw, "name", "categoryName")),
        parentExternalId:
          text(pick(raw, "parentId", "parentExternalId")) || undefined,
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
