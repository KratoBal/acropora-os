import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import ExcelJS from "exceljs";
import { prisma } from "@acropora/database";

import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";
import { UnasApplyRepository } from "./unas-apply.repository.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportService } from "./unas-import.service.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";

const enabled = process.env.RUN_DB_INTEGRATION === "1";

async function catalogFixture(options: {
  categoryName: string;
  firstName: string;
  firstImage: string;
  duplicateImage?: boolean;
}) {
  const workbook = new ExcelJS.Workbook();
  const products = workbook.addWorksheet("Products");
  products.addRow([
    "SKU",
    "Name",
    "Status",
    "Category ID",
    "Brand",
    "Images",
    "Kiegészítő termékek",
  ]);
  products.addRow([
    "APPLY-SKU-1",
    options.firstName,
    "2",
    "cat-apply",
    "Eheim",
    options.duplicateImage
      ? `${options.firstImage}|${options.firstImage}`
      : options.firstImage,
    "APPLY-SKU-2",
  ]);
  products.addRow([
    "APPLY-SKU-2",
    "Generic target product",
    "1",
    "cat-apply",
    "",
    "https://example.test/target.jpg",
    "",
  ]);
  const categories = workbook.addWorksheet("Categories");
  categories.addRow(["ID", "Name"]);
  categories.addRow(["cat-apply", options.categoryName]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function cleanup() {
  await prisma.catalogImportBatch.deleteMany();
  await prisma.domainEvent.deleteMany();
  await prisma.externalReference.deleteMany({ where: { system: "UNAS" } });
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
}

describe("UNAS Apply Import database integration", { skip: !enabled }, () => {
  const importRepository = new UnasImportRepository();
  const importService = new UnasImportService(
    new UnasXlsxParser(),
    new UnasImportValidator(),
    new UnasDiffEngine(),
    importRepository,
    new BrandResolutionEngine(),
  );
  const applyRepository = new UnasApplyRepository();
  const applyService = new UnasApplyService(applyRepository);

  before(cleanup);
  after(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function stageApprove(buffer: Buffer, name: string) {
    const report = await importService.stageAndDryRun({
      originalname: name,
      buffer,
    } as Express.Multer.File);
    const reviews = await prisma.brandResolutionReview.findMany({
      where: { batchId: report.batchId },
    });
    await applyService.approve(
      report.batchId,
      {
        brandDecisions: reviews.map((review) => ({
          sourceRowNumber: review.sourceRowNumber,
          decision: "NO_BRAND" as const,
        })),
      },
      "integration-owner",
    );
    return report.batchId;
  }

  it("applies, synchronizes and idempotently reuses an approved batch", async () => {
    const firstBatch = await stageApprove(
      await catalogFixture({
        categoryName: "Apply category",
        firstName: "Eheim test filter",
        firstImage: "https://example.test/first.jpg",
      }),
      "apply-first.xlsx",
    );
    const first = await applyService.apply(firstBatch, "integration-owner");
    const repeated = await applyService.apply(firstBatch, "integration-owner");

    assert.deepEqual(repeated, first);
    assert.equal(first.productsCreated, 2);
    assert.equal(first.categoriesCreated, 1);
    assert.equal(first.variantsCreated, 2);
    assert.equal(first.relationsSynchronized, 1);
    assert.equal(first.domainEventsCreated, 3);
    assert.equal(await prisma.product.count(), 2);
    assert.equal(await prisma.productVariant.count(), 2);
    assert.equal(await prisma.productRelation.count(), 1);
    assert.equal(await prisma.channelListing.count(), 2);
    assert.equal(await prisma.externalReference.count(), 3);
    assert.equal(await prisma.domainEvent.count(), 3);
    assert.equal(await prisma.stockMovement.count(), 0);
    assert.equal(await prisma.customer.count(), 0);
    assert.equal(await prisma.salesOrder.count(), 0);

    const [sourceVariant, targetVariant] = await Promise.all([
      prisma.productVariant.findUniqueOrThrow({
        where: { sku: "APPLY-SKU-1" },
      }),
      prisma.productVariant.findUniqueOrThrow({
        where: { sku: "APPLY-SKU-2" },
      }),
    ]);
    await prisma.productRelation.create({
      data: {
        sourceProductId: sourceVariant.productId,
        targetProductId: targetVariant.productId,
        relationType: "SIMILAR",
      },
    });

    const secondBatch = await stageApprove(
      await catalogFixture({
        categoryName: "Renamed apply category",
        firstName: "Eheim updated filter",
        firstImage: "https://example.test/updated.jpg",
      }),
      "apply-second.xlsx",
    );
    const second = await applyService.apply(secondBatch, "integration-owner");
    const updated = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: "APPLY-SKU-1" },
      include: { product: { include: { images: true, categories: true } } },
    });

    assert.equal(second.productsUpdated, 2);
    assert.equal(second.categoriesUpdated, 1);
    assert.equal(await prisma.product.count(), 2);
    assert.equal(updated.product.name, "Eheim updated filter");
    assert.deepEqual(
      updated.product.images.map((image) => image.url),
      ["https://example.test/updated.jpg"],
    );
    assert.equal(updated.product.categories.length, 1);
    assert.equal(
      await prisma.productRelation.count({ where: { source: null } }),
      1,
    );
    assert.equal(
      (
        await prisma.category.findFirstOrThrow({
          where: { id: updated.product.categories[0]!.categoryId },
        })
      ).name,
      "Renamed apply category",
    );
  });

  it("rolls back every domain write when synchronization fails", async () => {
    const batchId = await stageApprove(
      await catalogFixture({
        categoryName: "Rollback category",
        firstName: "Rollback product",
        firstImage: "https://example.test/duplicate.jpg",
        duplicateImage: true,
      }),
      "apply-rollback.xlsx",
    );
    const beforeCounts = await Promise.all([
      prisma.product.count(),
      prisma.productImage.count(),
      prisma.category.count(),
      prisma.domainEvent.count(),
    ]);

    await assert.rejects(() =>
      applyService.apply(batchId, "integration-owner"),
    );
    assert.deepEqual(
      await Promise.all([
        prisma.product.count(),
        prisma.productImage.count(),
        prisma.category.count(),
        prisma.domainEvent.count(),
      ]),
      beforeCounts,
    );
    assert.equal(
      (
        await prisma.catalogImportBatch.findUniqueOrThrow({
          where: { id: batchId },
        })
      ).status,
      "APPROVED",
    );
  });
});
