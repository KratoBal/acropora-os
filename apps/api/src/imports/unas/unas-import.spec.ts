import assert from "node:assert/strict";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";
import type {
  ImportRowResult,
  UnasParsedWorkbook,
  UnasProductImportRow,
} from "@acropora/types";

import {
  type CatalogProductSnapshot,
  UnasDiffEngine,
} from "./unas-diff.engine.js";
import type { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";

const product = (
  overrides: Partial<UnasProductImportRow> = {},
): UnasProductImportRow => ({
  sourceRowNumber: 2,
  externalId: "unas-1",
  sku: "SKU-1",
  name: "Reef pump",
  primaryCategoryExternalId: "cat-1",
  brandName: "Acme",
  imageUrls: ["https://example.test/pump.jpg"],
  externalStatus: "3",
  isActive: true,
  rawPayload: { sku: "SKU-1" },
  ...overrides,
});

const workbook = (
  products: UnasProductImportRow[] = [product()],
): UnasParsedWorkbook => ({
  products,
  categories: [
    {
      sourceRowNumber: 2,
      externalId: "cat-1",
      name: "Pumps",
      rawPayload: { id: "cat-1" },
    },
  ],
  brands: [
    {
      sourceRowNumber: 2,
      externalId: "brand-1",
      name: "Acme",
      rawPayload: { name: "Acme" },
    },
  ],
});

describe("UNAS XLSX parser", () => {
  it("reads required sheets and preserves source rows and raw values", async () => {
    const source = new ExcelJS.Workbook();
    const products = source.addWorksheet("Products");
    products.addRow(["ID", "SKU", "Name", "Status", "Category ID", "Images"]);
    products.addRow([
      "unas-1",
      "SKU-1",
      "Reef pump",
      "9",
      "cat-1",
      "https://example.test/one.jpg|https://example.test/two.jpg",
    ]);
    const categories = source.addWorksheet("Categories");
    categories.addRow(["ID", "Name"]);
    categories.addRow(["cat-1", "Pumps"]);
    const brands = source.addWorksheet("Brands");
    brands.addRow(["ID", "Name"]);
    brands.addRow(["brand-1", "Acme"]);
    const buffer = Buffer.from(await source.xlsx.writeBuffer());

    const parsed = await new UnasXlsxParser().parse(buffer);

    assert.equal(parsed.products[0]?.sourceRowNumber, 2);
    assert.equal(parsed.products[0]?.externalStatus, "9");
    assert.deepEqual(parsed.products[0]?.imageUrls, [
      "https://example.test/one.jpg",
      "https://example.test/two.jpg",
    ]);
    assert.equal(parsed.products[0]?.rawPayload.sku, "SKU-1");
    assert.equal(parsed.categories[0]?.externalId, "cat-1");
    assert.equal(parsed.brands[0]?.name, "Acme");
  });

  it("rejects a workbook without required sheets", async () => {
    const source = new ExcelJS.Workbook();
    source.addWorksheet("Products");
    const buffer = Buffer.from(await source.xlsx.writeBuffer());
    await assert.rejects(
      () => new UnasXlsxParser().parse(buffer),
      /Products és Categories/,
    );
  });

  it("maps real Hungarian UNAS headers and category paths", async () => {
    const source = new ExcelJS.Workbook();
    const products = source.addWorksheet("Products");
    products.addRow([
      "Cikkszám",
      "Termék Név",
      "Státusz",
      "Kategória",
      "Kiegészítő Kategóriák",
      "Paraméter: brand||text",
      "Kép link",
    ]);
    products.addRow([
      "SKU-HU",
      "Próba termék",
      "2",
      "Termékek | Szűrés ",
      "200;300",
      "Acme",
      "https://example.test/1.jpg|https://example.test/2.jpg",
    ]);
    const categories = source.addWorksheet("Categories");
    categories.addRow(["Azonosító", "Szülő kategória", "Kategória neve"]);
    categories.addRow(["100", "", "Termékek"]);
    categories.addRow(["200", "Termékek", "Szűrés"]);
    categories.addRow(["300", "Termékek", "Pumpák"]);

    const parsed = await new UnasXlsxParser().parse(
      Buffer.from(await source.xlsx.writeBuffer()),
    );

    assert.equal(parsed.products[0]?.sku, "SKU-HU");
    assert.equal(parsed.products[0]?.externalStatus, "2");
    assert.equal(parsed.products[0]?.primaryCategoryExternalId, "200");
    assert.deepEqual(parsed.products[0]?.alternativeCategoryExternalIds, [
      "200",
      "300",
    ]);
    assert.equal(parsed.categories[1]?.parentExternalId, "100");
    assert.deepEqual(parsed.products[0]?.imageUrls, [
      "https://example.test/1.jpg",
      "https://example.test/2.jpg",
    ]);
  });
});

describe("UNAS staging validation", () => {
  it("separates duplicate/missing/reference errors from warnings", () => {
    const parsed = workbook([
      product({
        imageUrls: ["not-a-url"],
        externalStatus: "9",
        brandName: "Unknown",
      }),
      product({
        sourceRowNumber: 3,
        name: "",
        primaryCategoryExternalId: "missing",
      }),
      product({ sourceRowNumber: 4, sku: "", name: "No SKU" }),
    ]);

    const results = new UnasImportValidator().validate(parsed);
    const codes = results.flatMap((row) =>
      row.issues.map((issue) => issue.code),
    );

    assert.ok(codes.includes("DUPLICATE_SKU"));
    assert.ok(codes.includes("MISSING_SKU"));
    assert.ok(codes.includes("MISSING_NAME"));
    assert.ok(codes.includes("INVALID_CATEGORY_REFERENCE"));
    assert.ok(codes.includes("MISSING_BRAND"));
    assert.ok(codes.includes("INVALID_IMAGE"));
    assert.ok(codes.includes("UNEXPECTED_STATUS"));
    assert.equal(results[0]?.row.rawPayload.sku, "SKU-1");
  });
});

describe("UNAS catalog diff engine", () => {
  const valid = (
    row: UnasProductImportRow,
  ): ImportRowResult<UnasProductImportRow> => ({
    sourceRowNumber: row.sourceRowNumber,
    row,
    issues: [],
    transformedEntityIds: {},
    status: "VALID",
  });

  it("detects create, unchanged and every supported changed field", () => {
    const current: CatalogProductSnapshot = {
      sku: "SKU-1",
      name: "Old title",
      brandName: "Old brand",
      categoryIds: ["old-category"],
      imageUrls: ["https://example.test/old.jpg"],
      externalStatus: "1",
      isActive: false,
    };
    const engine = new UnasDiffEngine();
    const changed = engine.diff(
      [valid(product())],
      new Map([["SKU-1", current]]),
    )[0]!;
    const created = engine.diff(
      [valid(product({ sku: "NEW" }))],
      new Map(),
    )[0]!;
    const unchanged = engine.diff(
      [
        valid(
          product({
            name: current.name,
            brandName: current.brandName ?? undefined,
            primaryCategoryExternalId: current.categoryIds[0],
            imageUrls: current.imageUrls,
            externalStatus: current.externalStatus ?? undefined,
            isActive: current.isActive,
          }),
        ),
      ],
      new Map([["SKU-1", current]]),
    )[0]!;

    assert.equal(created.action, "CREATE");
    assert.equal(unchanged.action, "UNCHANGED");
    assert.equal(changed.action, "UPDATE");
    assert.deepEqual(
      changed.changes.map((change) => change.field),
      ["title", "brand", "category", "images", "channelListing", "activeState"],
    );
  });
});

describe("UNAS dry run service", () => {
  it("persists staging and report without writing Product tables", async () => {
    const parsed = workbook();
    const calls: string[] = [];
    const repository = {
      findReportByHash: async () => null,
      catalogSnapshot: async () => new Map(),
      categorySnapshot: async () => new Map(),
      saveStaging: async () => {
        calls.push("staging");
        return "batch-1";
      },
      saveReport: async () => {
        calls.push("report");
      },
    } as unknown as UnasImportRepository;
    const service = new UnasImportService(
      { parse: async () => parsed } as UnasXlsxParser,
      new UnasImportValidator(),
      new UnasDiffEngine(),
      repository,
    );
    const file = {
      originalname: "catalog.xlsx",
      buffer: Buffer.from("xlsx"),
    } as Express.Multer.File;

    const report = await service.stageAndDryRun(file);

    assert.equal(report.batchId, "batch-1");
    assert.equal(report.summary.productsToCreate, 1);
    assert.equal(report.summary.categoriesToCreate, 1);
    assert.deepEqual(calls, ["staging", "report"]);
  });

  it("azonos fájlhash esetén a korábbi riportot adja vissza", async () => {
    let parserCalled = false;
    const existing = {
      batchId: "existing-batch",
      provider: "UNAS" as const,
      sourceFileName: "catalog.xlsx",
      generatedAt: "2026-01-01T00:00:00.000Z",
      summary: {
        productsToCreate: 0,
        productsToUpdate: 0,
        productsUnchanged: 1,
        categoriesToCreate: 0,
        categoriesToUpdate: 0,
        validationErrors: 0,
        warnings: 0,
      },
      products: [],
      issues: [],
    };
    const service = new UnasImportService(
      {
        parse: async () => {
          parserCalled = true;
          return workbook();
        },
      } as UnasXlsxParser,
      new UnasImportValidator(),
      new UnasDiffEngine(),
      {
        findReportByHash: async () => existing,
      } as unknown as UnasImportRepository,
    );

    const report = await service.stageAndDryRun({
      originalname: "catalog.xlsx",
      buffer: Buffer.from("same-xlsx"),
    } as Express.Multer.File);

    assert.equal(report, existing);
    assert.equal(parserCalled, false);
  });
});
