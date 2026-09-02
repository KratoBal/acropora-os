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
import { integrationDatabaseGate } from "../../common/integration-database.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const enabled = gate.mode !== "skip";

async function catalogFixture(options: {
  categoryName: string;
  firstName: string;
  firstImage: string;
  duplicateImage?: boolean;
  /**
   * A MASODIK TERMEK HIVATKOZASA, ha meg kell valtoztatni.
   *
   * Alapertelmezesben ures. A kis-nagybetu esethez ez a mezo kap egy olyan
   * cikkszamot, ami LETEZIK a katalogusban, csak mas irasmoddal.
   */
  secondReference?: string;
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
    options.secondReference ?? "",
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

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await cleanup();
  });
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
    // A MEGSZOKOTT MENETBEN SEMMI NEM VESZ EL. Ez a szam a masik allitas
    // parja: enelkul a szamlalo lehetne mindig nulla, es ugyanugy zold lenne.
    assert.equal(first.unresolvedRelationReferences, 0);
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
    assert.equal(updated.product.origin, "UNAS");
    assert.equal(updated.product.catalogAuthority, "UNAS");
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

  /**
   * A FEL NEM OLDOTT HIVATKOZAS NYOMOT HAGY.
   *
   * A UNAS cikkszammal hivatkozik a kapcsolodo termekekre, es a feloldas
   * KIS-NAGYBETU ERZEKENY. Eddig a nem-talalat CSENDES volt: a `syncRelations`
   * egyetlen `continue`-val lepett tovabb, ugyanazzal, amivel az onhivatkozast es
   * a duplikatumot is kihagyja -- tehat harom kulonbozo ok volt
   * megkulonboztethetetlen, es kozuluk csak az egyik adatvesztes.
   *
   * MERVE (barracuda, 2026-09-02, kartya b609d3e6): 589 hivatkozas veszett el
   * igy, 58 EGYEDI cikkszambol (33 a hasonlo agon, 40 a kiegeszito agon, 15
   * MINDKETTON -- ezert 58 es nem 73), es kis-nagybetu fuggetlenul NULLA
   * hivatkozott cikkszam hianyzik a katalogusbol.
   *
   * ES MIND AZ 58 UGYANAZ AZ ALAK: a katalogusbeli cikkszam teljesen kisbetus
   * valtozata. A mi importunk NEM kisbetusit (merve: a parser csak a
   * fejlec-kulcsokat normalizalja, az apply-tarolo teljes fajljaban nulla
   * `toLowerCase`), tehat a forras adja igy.
   *
   * EZ A TESZT NEM A PAROSITAST MERI. Az tovabbra is kis-nagybetu erzekeny marad
   * (az megvaltoztatasa adatmodell-kerdes). Amit mer: hogy a vesztes SZAMOLVA
   * van, tehat a futas utan meg lehet nezni, tortent-e valami.
   */
  it("counts a reference it could not resolve, instead of dropping it silently", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Case category",
        firstName: "Case test product",
        firstImage: "https://example.test/case.jpg",
        // LETEZO cikkszam, MAS irasmoddal: a katalogusban "APPLY-SKU-1" all.
        secondReference: "apply-sku-1",
      }),
      "apply-case.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    // A hivatkozas NEM oldodott fel (a parositas valtozatlanul erzekeny)...
    assert.equal(report.unresolvedRelationReferences, 1);
    // ...es epp ezert nem is keletkezett belole kapcsolat.
    assert.equal(report.relationsSynchronized, 1);
  });
});
