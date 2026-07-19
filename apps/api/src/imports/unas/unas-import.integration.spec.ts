import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import ExcelJS from "exceljs";
import { prisma } from "@acropora/database";

import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";
import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1";

async function fixture() {
  const source = new ExcelJS.Workbook();
  const products = source.addWorksheet("Products");
  products.addRow(["SKU", "Name", "Status", "Category ID"]);
  products.addRow(["INTEGRATION-SKU", "Integration product", "3", "cat-1"]);
  const categories = source.addWorksheet("Categories");
  categories.addRow(["ID", "Name"]);
  categories.addRow(["cat-1", "Integration category"]);
  return Buffer.from(await source.xlsx.writeBuffer());
}

describe("UNAS database integration", { skip: !enabled }, () => {
  const repository = new UnasImportRepository();
  const service = new UnasImportService(
    new UnasXlsxParser(),
    new UnasImportValidator(),
    new UnasDiffEngine(),
    repository,
    new BrandResolutionEngine(),
  );

  before(async () => {
    await prisma.catalogImportBatch.deleteMany();
  });

  after(async () => {
    await prisma.catalogImportBatch.deleteMany();
    await prisma.$disconnect();
  });

  it("persists an atomic, idempotent dry run without domain writes", async () => {
    const buffer = await fixture();
    const beforeCounts = await Promise.all([
      prisma.product.count(),
      prisma.stockMovement.count(),
    ]);
    const file = {
      originalname: "synthetic-unas-catalog.xlsx",
      buffer,
    } as Express.Multer.File;

    const first = await service.stageAndDryRun(file);
    const second = await service.stageAndDryRun(file);
    const reloaded = await service.getReport(first.batchId);
    const [batchCount, rows, reviews, productCount, movementCount] =
      await Promise.all([
        prisma.catalogImportBatch.count(),
        prisma.catalogImportRow.findMany({ where: { batchId: first.batchId } }),
        prisma.brandResolutionReview.findMany({
          where: { batchId: first.batchId },
        }),
        prisma.product.count(),
        prisma.stockMovement.count(),
      ]);

    assert.equal(second.batchId, first.batchId);
    assert.equal(reloaded.batchId, first.batchId);
    assert.equal(batchCount, 1);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.rawPayload && row.parsedPayload));
    assert.equal(reviews.length, 1);
    assert.equal(first.brandResolution?.products.length, 1);
    assert.equal(
      first.brandResolution?.summary.productsMissingExplicitBrand,
      1,
    );
    assert.deepEqual(
      rows.find((item) => item.entityType === "PRODUCT")?.rawPayload,
      {
        sourceRowNumber: 2,
        sku: "INTEGRATION-SKU",
        name: "Integration product",
        status: "3",
        categoryid: "cat-1",
      },
    );
    assert.equal(productCount, beforeCounts[0]);
    assert.equal(movementCount, beforeCounts[1]);
  });

  it("rolls back the whole staging batch when nested rows violate uniqueness", async () => {
    const parsed = await new UnasXlsxParser().parse(await fixture());
    parsed.products.push({
      ...parsed.products[0]!,
      rawPayload: { duplicate: true },
    });
    const validated = new UnasImportValidator().validate(parsed);
    const beforeCount = await prisma.catalogImportBatch.count();

    await assert.rejects(() =>
      repository.saveStaging(
        "invalid-duplicate.xlsx",
        "rollback-test-hash",
        parsed,
        validated,
        "rollback-test-version",
      ),
    );
    assert.equal(await prisma.catalogImportBatch.count(), beforeCount);
  });

  it("does not leave partial review changes when report persistence fails", async () => {
    const batch = await prisma.catalogImportBatch.findFirstOrThrow({
      where: { sourceFileName: "synthetic-unas-catalog.xlsx" },
    });
    const report = await repository.getReport(batch.id);
    const beforeReviews = await prisma.brandResolutionReview.findMany({
      where: { batchId: batch.id },
    });
    const invalidResolution = {
      ...report!.brandResolution!.products[0]!,
      sourceRowNumber: 999999,
    };

    await assert.rejects(() =>
      repository.saveResolutionAndReport(
        batch.id,
        [invalidResolution],
        report!,
      ),
    );
    assert.deepEqual(
      await prisma.brandResolutionReview.findMany({
        where: { batchId: batch.id },
      }),
      beforeReviews,
    );
  });
});
