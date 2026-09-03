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
  /**
   * KET TOVABBI TERMEK, AMIK CSAK KIS-NAGYBETUBEN TERNEK EL.
   *
   * Ez az UTKOZES esete, es kulon fixture-t igenyel: a valodi katalogusban ma
   * NINCS ilyen par (1893 termek, 1893 egyedi kisbetusitett alak), tehat a
   * "tobb talalat" ag valodi adaton SOSEM futna le. Barracuda merte fel ezt
   * elore, meg a teszt megirasa elott.
   */
  collidingPair?: boolean;
  /**
   * A KAPCSOLO-OSZLOPOK, AHOGY A VALODI MUNKAFUZETBEN ALLNAK: 0 vagy 1.
   *
   * A nevuk pontosan az, amit a REGI mezolista cikkszamkent olvasott, tehat ez
   * a fixture azt meri, hogy MOST mar nem olvassuk oket.
   */
  switchColumns?: boolean;
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
    ...(options.switchColumns
      ? ["CrossSale1", "CrossSale2", "CrossSale3", "UpSale1", "UpSale2"]
      : []),
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
    ...(options.switchColumns ? [1, 0, 1, 0, 1] : []),
  ]);
  products.addRow([
    "APPLY-SKU-2",
    "Generic target product",
    "1",
    "cat-apply",
    "",
    "https://example.test/target.jpg",
    options.secondReference ?? "",
    ...(options.switchColumns ? [0, 1, 0, 1, 0] : []),
  ]);
  if (options.collidingPair) {
    products.addRow([
      "COLLIDE-1",
      "Upper case product",
      "1",
      "cat-apply",
      "",
      "https://example.test/upper.jpg",
      "",
    ]);
    products.addRow([
      "collide-1",
      "Lower case product",
      "1",
      "cat-apply",
      "",
      "https://example.test/lower.jpg",
      "",
    ]);
  }
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
  /**
   * A KAPCSOLO-OSZLOPOK NEM HIVATKOZASOK, ES NEM IS SZAMOLODNAK.
   *
   * A valodi munkafuzetben a `CrossSale1..3` es az `UpSale1..2` oszlop NUMBER
   * tipusu, 0 vagy 1 ertekkel (merve: barracuda, 2026-09-03, a
   * `unas-teljes-export-2026-09-02/termekek.xml` 1893 adatsoran; egyetlen
   * szoveges ertek sincs bennuk a fejlecen kivul).
   *
   * A `rawText` a szam 0-t is `"0"`-va alakitja -- nem ures string, tehat NEM
   * esik ki --, es a `splitReferences` egyelemu listat csinal belole. Ha
   * ezeket az oszlopokat olvasnank, MINDEN sorbol OT hamis hivatkozas
   * keletkezne: 5 * 1893 = 9465 darab, ami sosem oldodik fel.
   *
   * A KAR NEM ROSSZ KAPCSOLAT: a katalogusban nincs "0" es nincs "1" nevu
   * cikkszam, tehat ezek sosem kotottek volna ossze rossz termekeket. A kar a
   * SZAMOKON van -- a valodi vesztes elveszett volna a zajban.
   */
  it("ignores the switch columns instead of reading them as SKUs", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Switch category",
        firstName: "Switch test product",
        firstImage: "https://example.test/switch.jpg",
        switchColumns: true,
      }),
      "apply-switch.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    // A "0" es az "1" NEM lett hivatkozas.
    assert.equal(report.unresolvedRelationReferences, 0);
    // Es a valodi hivatkozas-oszlop tovabbra is mukodik: a masodik termek
    // hivatkozasa az elsore letrejott.
    assert.equal(report.relationsSynchronized, 1);
  });

  it("resolves a differently cased reference, and says it fell back", async () => {
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

    // A HAROM SZAM EGYUTT MER, es egyik sem elhagyhato:
    // feloldodott, VISSZAESESSEL, es nem tunt el csendben.
    assert.equal(report.relationReferencesResolvedByCaseFallback, 1);
    assert.equal(report.unresolvedRelationReferences, 0);
    assert.equal(report.relationsSynchronized, 2);
    // Es NEM utkozeskent: egyetlen termek illeszkedett.
    assert.equal(report.relationReferencesAmbiguous, 0);
  });

  /**
   * A PAR EGY KAPCSOLATOT AD, NEM KETTOT -- ES EZ SZAMOLVA VAN.
   *
   * A valodi adatban 269 ilyen par all (helyes alak plusz kisbetus masolat,
   * ugyanazon a terméken; pontos irasmoddal NULLA ismetlodes). Ma a masodik tag
   * fel sem oldodik. A visszaeses utan MINDKETTO feloldodik, es a masodikat a
   * duplikatum-szures viszi el -- ha nem szamolnank, egy nema vesztest
   * cserelnenk egy masik NEMA KIHAGYASRA.
   */
  it("counts the duplicate it skipped, instead of just dropping it", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Pair category",
        firstName: "Pair test product",
        firstImage: "https://example.test/pair.jpg",
        // UGYANAZ a termek KETSZER: helyes alak es kisbetus masolat.
        secondReference: "APPLY-SKU-1|apply-sku-1",
      }),
      "apply-pair.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    assert.equal(report.relationReferencesResolvedByCaseFallback, 1);
    assert.equal(report.relationReferencesSkippedAsDuplicate, 1);
    // EGY kapcsolat lett belole, nem ketto.
    assert.equal(report.relationsSynchronized, 2);
  });

  /**
   * UTKOZESNEL NEM TIPPELUNK, ES EZ SAJAT FIXTURE-T IGENYEL.
   *
   * A valodi katalogusban ma NINCS ket termek, ami csak kis-nagybetuben ter el
   * (merve: 1893 termek, 1893 egyedi kisbetusitett alak). Vagyis a valodi
   * adaton ez az ag SOSEM futna le, es egy teszt, ami csak valodi cikkszamokat
   * hasznal, a feltetellel ES nelkule is zold lenne. Ezert all itt szandekos
   * utkozes.
   */
  /**
   * A FELOLDATLANOK MEZONKENT IS SZAMOLODNAK.
   *
   * Az osszeg nem valasztja szet a valodi vesztest attol, ha egy forras-oszlop
   * egyaltalan nem cikkszamokat tartalmaz. A betolto HET oszlopot olvas
   * cikkszam-listakent, es barracuda merese csak KETTOT fed -- ha a tobbiben
   * kapcsolok allnak ("no", "yes"), azok sosem oldodnak fel, es az osszegben
   * megkulonboztethetetlenek lennenek.
   *
   * A BONTASSAL AZ ELSO ELES FUTAS MAGATOL VALASZOL: ha a feloldatlanok a
   * `crosssale*` oszlopokbol jonnek, a teendo a mezolista szukitese.
   */
  it("names the field a reference could not be resolved from", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Field category",
        firstName: "Field test product",
        firstImage: "https://example.test/field.jpg",
        // NEM LETEZO cikkszam, tehat meg a visszaeses sem talalja meg.
        secondReference: "NINCS-ILYEN-SKU",
      }),
      "apply-field.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    assert.equal(report.unresolvedRelationReferences, 1);
    // ES MEGNEVEZI AZ OSZLOPOT, nem csak osszegez.
    assert.deepEqual(report.relationReferencesByField, {
      kiegeszitotermekek: 1,
    });
    // A visszaeses NEM sult el: nincs mihez visszaesni.
    assert.equal(report.relationReferencesResolvedByCaseFallback, 0);
  });

  /**
   * ES HA MINDEN FELOLDODIK, A BONTAS URES -- nem nullakkal teli.
   *
   * Ez a parja az elozonek: enelkul a bontas lehetne mindig ures, es az elso
   * allitas ugyanugy zold maradna.
   */
  it("leaves the breakdown empty when nothing was lost", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Clean category",
        firstName: "Clean test product",
        firstImage: "https://example.test/clean.jpg",
        secondReference: "apply-sku-1",
      }),
      "apply-clean.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    assert.deepEqual(report.relationReferencesByField, {});
    assert.equal(report.relationReferencesResolvedByCaseFallback, 1);
  });

  /**
   * A HARMADIK KIHAGYASI OK: A TERMEK ONMAGARA MUTAT.
   *
   * A fixture epp azt az alakot allitja elo, amibol a valodi exportban HARMINC
   * van: az `APPLY-SKU-2` a SAJAT cikkszamat sorolja fel, kisbetusen. Pontos
   * egyezessel nem talalna meg magat, tehat ma feloldatlankent szamolodna; a
   * visszaeses feloldja, es akkor derul ki, hogy onmagara mutat.
   *
   * A NEGYEDIK ALLITAS AZ, AMI SZAMIT: a duplikatum-szamlalo NULLA marad. Ha az
   * onhivatkozas oda kerulne, harom allitas ugyanigy zold lenne, es csak ez az
   * egy mondana meg, hogy rossz vodorbe esett.
   */
  it("counts a self-reference in its own bucket, not as a duplicate", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Self reference category",
        firstName: "Self reference test product",
        firstImage: "https://example.test/self.jpg",
        // Az APPLY-SKU-2 sajat magara hivatkozik, MAS irasmoddal.
        secondReference: "apply-sku-2",
      }),
      "apply-self.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    /**
     * ES EZ AZ ALLITAS FOGJA MEG A VALODI KART, nem a konyvelest.
     *
     * Ha az ag SZAMOL, de nem lep ki -- pontosan a #404 alakja --, akkor a
     * szamlalo helyes marad, a termek viszont KAPCSOLATOT KAP ONMAGARA, es
     * egyetlen szamlalo sem szol. Csak ez a szam valtozik: 1 helyett 2.
     */
    assert.equal(report.relationsSynchronized, 1);
    assert.equal(report.relationReferencesSkippedAsSelfReference, 1);
    // A visszaeses feloldotta -- enelkul feloldatlan lenne, nem onhivatkozas.
    assert.equal(report.relationReferencesResolvedByCaseFallback, 1);
    assert.equal(report.unresolvedRelationReferences, 0);
    // ES NEM DUPLIKATUM: mas a teendo, tehat mas a szamlalo.
    assert.equal(report.relationReferencesSkippedAsDuplicate, 0);
    // A mezo-bontasba sem kerul bele: nem az oszlop hibaja.
    assert.deepEqual(report.relationReferencesByField, {});
  });

  it("does not guess when the fallback finds more than one product", async () => {
    const batch = await stageApprove(
      await catalogFixture({
        categoryName: "Collision category",
        firstName: "Collision test product",
        firstImage: "https://example.test/collide.jpg",
        collidingPair: true,
        // Egy HARMADIK irasmod, ami MINDKET utkozo termekre illeszkedne.
        secondReference: "Collide-1",
      }),
      "apply-collide.xlsx",
    );

    const report = await applyService.apply(batch, "integration-owner");

    assert.equal(report.relationReferencesAmbiguous, 1);
    // NEM oldottuk fel, tehat kapcsolat sem keletkezett belole...
    assert.equal(report.relationReferencesResolvedByCaseFallback, 0);
    // ...es NEM is szamoljuk feloldatlannak: a ket eset teendoje mas.
    assert.equal(report.unresolvedRelationReferences, 0);
    /**
     * ES A MEZO-BONTASBA SEM KERUL BELE.
     *
     * Ez a harmadik allitas parja, es kulon kell: ha az utkozes a bontasba
     * kerulne, az azt sugallna, hogy abbol az OSZLOPBOL jott a vesztes -- es a
     * teendo ott mas. Nem a mezolistat kell szukiteni, hanem a katalogusban all
     * ket osszeteveszthető cikkszam.
     */
    assert.deepEqual(report.relationReferencesByField, {});
  });
});
