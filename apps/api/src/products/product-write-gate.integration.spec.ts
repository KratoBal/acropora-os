import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { ConflictException } from "@nestjs/common";
import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ProductRepository } from "./product.repository.js";
import { ProductService } from "./product.service.js";

// This suite writes and deletes rows, so it runs only against a database named
// for testing; see integrationDatabaseGate.
const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * A szerver oldali írási határ, méréssel.
 *
 * A kérdés nem az, hogy a képernyő felkínálja-e a szerkesztést, hanem hogy a
 * szerver megengedi-e. Ezért ez a suite a SZOLGÁLTATÁST hívja, nem a felületet,
 * és minden állítást az ADATBÁZISBÓL igazol vissza: egy elutasított hívás után
 * nem elég, hogy hibát kaptunk, azt is meg kell nézni, hogy tényleg nem
 * változott semmi.
 */

const PREFIX = `write-gate-${Date.now()}`;

async function makeProduct(
  authority: "UNAS" | "ACROPORA" | null,
  categoryId: string,
) {
  return prisma.product.create({
    data: {
      name: `${PREFIX} eredeti név`,
      description: "eredeti leírás",
      type: "PHYSICAL",
      origin: "UNAS",
      catalogAuthority: authority,
      mirrorSource: "UNAS",
      mirrorState: "ACTIVE",
      rawSourceHash: "eredeti-hash",
      categoryId,
      categories: {
        create: { categoryId, isPrimary: true, source: "UNAS" },
      },
    },
  });
}

/**
 * Csak a saját sorait takarítja, névelőtag szerint. Egy `deleteMany()`, ami
 * típusra szűr, idegen sorokra is illeszkedne.
 */
async function cleanup() {
  const products = await prisma.product.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = products.map((product) => product.id);
  if (ids.length) {
    await prisma.productCategory.deleteMany({
      where: { productId: { in: ids } },
    });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.category.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

describe(
  "Product master write gate integration",
  { skip: !runIntegration },
  () => {
    const service = new ProductService(new ProductRepository());
    let firstCategoryId: string;
    let secondCategoryId: string;

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await cleanup();
      const first = await prisma.category.create({
        data: { name: `${PREFIX} első`, slug: `${PREFIX}-elso` },
      });
      const second = await prisma.category.create({
        data: { name: `${PREFIX} második`, slug: `${PREFIX}-masodik` },
      });
      firstCategoryId = first.id;
      secondCategoryId = second.id;
    });

    after(async () => {
      await cleanup();
      await prisma.$disconnect();
    });

    /**
     * Az első állítás: a tiltás a szerveren áll. A hiba önmagában kevés lenne -
     * egy olyan szolgáltatás, ami hibát dob ÉS közben ír, ugyanezt a hibát
     * adná -, ezért az adatbázisból is visszaolvassuk mind a három mezőt.
     */
    it("refuses all three fields on a webshop-owned product, and writes nothing", async () => {
      const product = await makeProduct("UNAS", firstCategoryId);

      await assert.rejects(
        service.updateProduct(product.id, {
          name: `${PREFIX} tiltott név`,
          description: "tiltott leírás",
          primaryCategoryId: secondCategoryId,
        }),
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message === "PRODUCT_MANAGED_BY_UNAS",
      );

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { name: true, description: true, categoryId: true },
      });
      assert.equal(after.name, `${PREFIX} eredeti név`);
      assert.equal(after.description, "eredeti leírás");
      assert.equal(after.categoryId, firstCategoryId);

      const links = await prisma.productCategory.findMany({
        where: { productId: product.id },
        select: { categoryId: true, isPrimary: true, source: true },
      });
      assert.deepEqual(links, [
        { categoryId: firstCategoryId, isPrimary: true, source: "UNAS" },
      ]);
    });

    /**
     * A másik fele, és e nélkül a teszt egy olyan szolgáltatással is átmenne,
     * ami MINDENKINEK mindent tilt.
     */
    it("writes all three fields on a product we own", async () => {
      const product = await makeProduct("ACROPORA", firstCategoryId);

      await service.updateProduct(product.id, {
        name: `${PREFIX} új név`,
        description: "új leírás",
        primaryCategoryId: secondCategoryId,
      });

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { name: true, description: true, categoryId: true },
      });
      assert.equal(after.name, `${PREFIX} új név`);
      assert.equal(after.description, "új leírás");
      assert.equal(after.categoryId, secondCategoryId);
    });

    /**
     * A kategória KÉT reprezentációban él, és az előző kör megmutatta, hogy a
     * szinkron oldalon ez három külön írás. Itt azt mérjük, mi történik a
     * kapcsolatokkal, amikor a szerkesztés átsorol: a skalár és a kapcsolat
     * egyetértenek-e abban, MELYIK az elsődleges.
     */
    it("keeps the scalar and the links agreeing on which category is primary", async () => {
      const product = await makeProduct("ACROPORA", firstCategoryId);

      await service.updateProduct(product.id, {
        primaryCategoryId: secondCategoryId,
      });

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { categoryId: true },
      });
      const links = await prisma.productCategory.findMany({
        where: { productId: product.id },
        orderBy: { createdAt: "asc" },
        select: { categoryId: true, isPrimary: true, source: true },
      });

      const primary = links.filter((link) => link.isPrimary);
      assert.equal(
        primary.length,
        1,
        "pontosan egy elsődleges kapcsolat maradhat",
      );
      assert.equal(primary[0]?.categoryId, after.categoryId);
      assert.equal(primary[0]?.source, "MANUAL");

      // A MÉRÉS, ami a következő kört érinti: az előző elsődleges kapcsolat
      // NEM tűnik el, csak elveszti az elsődleges jelzőt. A képernyő ma minden
      // kapcsolatot badge-ként mutat, tehát egy átsorolt termék a régi
      // kategóriáját is mutatni fogja.
      assert.equal(links.length, 2);
      const previous = links.find(
        (link) => link.categoryId === firstCategoryId,
      );
      assert.equal(previous?.isPrimary, false);
      assert.equal(previous?.source, "UNAS");
    });

    /**
     * Feloldatlan gazda: nem tudjuk, kié a sor, tehát nem írjuk. Fail-closed,
     * és ugyanúgy az adatbázisból igazolva, mint a tiltott eset.
     */
    it("fails closed when the owner is unknown, and writes nothing", async () => {
      const product = await makeProduct(null, firstCategoryId);

      await assert.rejects(
        service.updateProduct(product.id, { name: `${PREFIX} tiltott név` }),
        (error: unknown) =>
          error instanceof ConflictException &&
          error.message === "PRODUCT_CATALOG_AUTHORITY_UNRESOLVED",
      );

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { name: true },
      });
      assert.equal(after.name, `${PREFIX} eredeti név`);
    });

    /**
     * A tükör-mezők nem ezen az úton íródnak. A HTTP réteg egy ismeretlen mezőt
     * már a kontroller előtt visszautasít (`whitelist` és
     * `forbidNonWhitelisted` a main.ts-ben), de az itt mért védelem ennél
     * erősebb: a tároló réteg NÉV SZERINT sorolja fel, mit ír, tehát akkor sem
     * írná őket, ha valahogy eljutnának idáig.
     */
    it("never writes mirror bookkeeping, even when it is handed one", async () => {
      const product = await makeProduct("ACROPORA", firstCategoryId);

      await service.updateProduct(product.id, {
        name: `${PREFIX} átírt név`,
        mirrorState: "MISSING",
        rawSourceHash: "hamisitott-hash",
        lastSyncedAt: new Date("2000-01-01T00:00:00.000Z"),
      } as never);

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: {
          name: true,
          mirrorSource: true,
          mirrorState: true,
          rawSourceHash: true,
          lastSyncedAt: true,
        },
      });
      assert.equal(after.name, `${PREFIX} átírt név`);
      assert.equal(after.mirrorSource, "UNAS");
      assert.equal(after.mirrorState, "ACTIVE");
      assert.equal(after.rawSourceHash, "eredeti-hash");
      assert.equal(after.lastSyncedAt, null);
    });
  },
);
