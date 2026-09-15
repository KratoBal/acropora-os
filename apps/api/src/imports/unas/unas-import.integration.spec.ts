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
import { integrationDatabaseGate } from "../../common/integration-database.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const enabled = gate.mode !== "skip";

/**
 * A FIXTURA FAJLNEVE, ES EZ A TAKARITAS HATOKORE IS.
 *
 * EGY HELYEN ALL, mert a ketto UGYANAZ a halmaz: amit ez a suite feltolt, azt
 * kell eltakaritania. Ket kulon leirt szoveg eseten az egyik peldany egyszer
 * elcsuszna, es a takaritas onnantol nulla sorra illeszkedne -- csendben.
 */
const FIXTURA_FAJLNEV = "synthetic-unas-catalog.xlsx";

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

  /**
   * A TAKARITAS A SAJAT SORAIRA SZUR, ES 2026-09-15 ELOTT NEM TETTE.
   *
   * A ket hivas `deleteMany()` alakban allt, argumentum NELKUL -- vagyis a
   * TELJES `CatalogImportBatch` tablat uritette, nem csak azt, amit ez a suite
   * toltott fel. Merve (verify job 104337824776, ket sor-pillanatkep a futas
   * korul): negy spec torolt igy, hat tablat erintve; a `Category` es a
   * `Product` seedelt referencia-sorai is elmentek.
   *
   * AMI NEM KOCKAZAT, es mondjuk is ki: az `integrationDatabaseGate` miatt ez
   * CSAK `_test` vagy `_ci` vegu adatbazison tud lefutni. Eles adat nem forgott
   * kockan. A kar hataron belul volt: egyik suite a masik adatat vitte el.
   *
   * ES AMIERT EZ NEM CSAK RENDETLENSEG: a futtato `--test-concurrency=1`, a
   * fajlok sorban futnak, es a sorrendet a `find` adja. Egy suite, ami ma a
   * torles ELOTT fut, holnap UTANA futhat -- es akkor mas vilagot lat.
   */
  async function removeLeftovers() {
    await prisma.catalogImportBatch.deleteMany({
      where: { sourceFileName: FIXTURA_FAJLNEV },
    });
  }

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    await removeLeftovers();
    await prisma.$disconnect();
  });

  it("persists an atomic, idempotent dry run without domain writes", async () => {
    const buffer = await fixture();
    const beforeCounts = await Promise.all([
      prisma.product.count(),
      prisma.stockMovement.count(),
    ]);
    const file = {
      originalname: FIXTURA_FAJLNEV,
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

  /**
   * A TAKARITAS TENYLEG LEFUT-E. A CI-kapu (`scripts/tap-stream-gate.mjs`) azt
   * fogja meg, ha a takaritas DOB; ez azt, ha CSENDBEN NEM CSINAL SEMMIT --
   * peldaul mert a fajlnev elcsuszik, es a `deleteMany` nulla sorra illeszkedik.
   *
   * A `CatalogImportRow` es a `BrandResolutionReview` NEM kap kulon szamlalot:
   * mindketto `Cascade`-del fugg a kotegtol, tehat a koteg nulla szama
   * bizonyitja oket is.
   *
   * EZ AZ UTOLSO TESZT A FAJLBAN, ES ANNAK IS KELL MARADNIA.
   */
  it("a takarítás tényleg lefut: nem marad sor a fixtúra fájlnevével", async () => {
    await removeLeftovers();

    assert.equal(
      await prisma.catalogImportBatch.count({
        where: { sourceFileName: FIXTURA_FAJLNEV },
      }),
      0,
      "maradt import-köteg a fixtúra fájlnevével",
    );
  });
});
