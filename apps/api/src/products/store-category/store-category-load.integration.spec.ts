import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { main } from "./store-category-load.cli.js";

/**
 * AZ ACROPORA-KATEGÓRIAFA A VALÓDI SÉMÁN (SEO P0 PR 10). A részleges egyedi
 * index (termékenként egy primary) és a slugcsere tranzakciója csak itt
 * találkozik Postgresszel.
 *
 * MI PIROSÍT: két primary megfér egy terméken; a száraz futás ír; a betöltés nem
 * idempotens; a slugcsere nem ír `SlugHistory`-t vagy átirányítást.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "STORE-CAT-INT-";

describe(
  "Acropora-kategóriafa, adatbázison",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = String(Date.now() % 1_000_000);
    const slug = (s: string) => `store-cat-int-${suffix}-${s}`;
    const sku = `${PREFIX}${suffix}`;
    let productId = "";
    let unasCategoryId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      const product = await prisma.product.create({
        data: { name: `${PREFIX}Lámpa ${suffix}` },
        select: { id: true },
      });
      productId = product.id;
      await prisma.productVariant.create({ data: { productId, sku } });
      const unas = await prisma.category.create({
        data: { name: `${PREFIX}UNAS ${suffix}`, slug: slug("unas") },
        select: { id: true },
      });
      unasCategoryId = unas.id;
    });

    after(removeLeftovers);

    async function removeLeftovers() {
      const kategoriak = await prisma.storeCategory.findMany({
        where: { slug: { startsWith: "store-cat-int-" } },
        select: { id: true },
      });
      const ids = kategoriak.map((k) => k.id);
      await prisma.urlRedirect.deleteMany({ where: { entityId: { in: ids } } });
      await prisma.slugHistory.deleteMany({
        where: { entityType: "STORE_CATEGORY", entityId: { in: ids } },
      });
      await prisma.unasCategoryMapping.deleteMany({
        where: { unasCategory: { name: { startsWith: PREFIX } } },
      });
      await prisma.storeCategoryProduct.deleteMany({
        where: { storeCategoryId: { in: ids } },
      });
      // gyerek előbb: a szülő-kapcsolat Restrict
      await prisma.storeCategory.deleteMany({
        where: { id: { in: ids }, parentId: { not: null } },
      });
      await prisma.storeCategory.deleteMany({ where: { id: { in: ids } } });
      await prisma.category.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.productVariant.deleteMany({
        where: { sku: { startsWith: PREFIX } },
      });
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      nincsMaradek([
        {
          nev: "StoreCategory",
          darab: await prisma.storeCategory.count({
            where: { slug: { startsWith: "store-cat-int-" } },
          }),
        },
        {
          nev: "Category",
          darab: await prisma.category.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "Product",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
      ]);
    }

    const csendes = { stdout: () => {}, stderr: () => {} };
    const futtat = (file: unknown, apply: boolean) =>
      main(
        apply ? ["fa.json", "--apply"] : ["fa.json"],
        csendes,
        prisma,
        async () => JSON.stringify(file),
      );

    const elsoFa = () => ({
      categories: [
        { slug: slug("vilagitas"), name: "Világítás" },
        { slug: slug("led"), name: "LED lámpák", parent: slug("vilagitas") },
      ],
      products: [
        {
          sku,
          categories: [slug("led"), slug("vilagitas")],
          primary: slug("led"),
        },
      ],
      unasMappings: [{ unasCategoryId, storeCategory: slug("vilagitas") }],
    });

    it("a száraz futás nem ír, az --apply betölti, és a második futás nulla változás", async () => {
      assert.equal(await futtat(elsoFa(), false), 0);
      assert.equal(
        await prisma.storeCategory.count({
          where: { slug: { startsWith: `store-cat-int-${suffix}` } },
        }),
        0,
      );

      assert.equal(await futtat(elsoFa(), true), 0);
      const led = await prisma.storeCategory.findUniqueOrThrow({
        where: { slug: slug("led") },
        select: { id: true, parent: { select: { slug: true } } },
      });
      assert.equal(led.parent?.slug, slug("vilagitas"));
      const sorok = await prisma.storeCategoryProduct.findMany({
        where: { productId },
        orderBy: { sortOrder: "asc" },
        select: { storeCategory: { select: { slug: true } }, isPrimary: true },
      });
      assert.deepEqual(
        sorok.map((s) => [s.storeCategory.slug, s.isPrimary]),
        [
          [slug("led"), true],
          [slug("vilagitas"), false],
        ],
      );
      const lekepezes = await prisma.unasCategoryMapping.findUniqueOrThrow({
        where: { unasCategoryId },
        select: { storeCategory: { select: { slug: true } } },
      });
      assert.equal(lekepezes.storeCategory?.slug, slug("vilagitas"));

      // idempotens: ugyanaz a fájl még egyszer
      const out: string[] = [];
      await main(
        ["fa.json"],
        { stdout: (v) => out.push(v), stderr: () => {} },
        prisma,
        async () => JSON.stringify(elsoFa()),
      );
      assert.match(out.join(""), /KATEGÓRIA: 0 új, 0 módosul, 0 slugcsere/);
      assert.match(out.join(""), /TERMÉK: 0 besorolás változik/);
    });

    it("a slugcsere SlugHistory-t és átirányítást ír, egy tranzakcióban", async () => {
      const led = await prisma.storeCategory.findUniqueOrThrow({
        where: { slug: slug("led") },
        select: { id: true },
      });
      const fa = elsoFa();
      fa.categories[1] = {
        id: led.id,
        slug: slug("led-lampak"),
        name: "LED lámpák",
        parent: slug("vilagitas"),
      } as (typeof fa.categories)[number];
      fa.products[0]!.categories = [slug("led-lampak"), slug("vilagitas")];
      fa.products[0]!.primary = slug("led-lampak");
      assert.equal(await futtat(fa, true), 0);

      const elozmeny = await prisma.slugHistory.findMany({
        where: { entityType: "STORE_CATEGORY", entityId: led.id },
        select: { slug: true },
      });
      assert.deepEqual(elozmeny, [{ slug: slug("led") }]);
      const szabaly = await prisma.urlRedirect.findFirstOrThrow({
        where: { entityType: "STORE_CATEGORY", entityId: led.id },
        select: { sourcePath: true, destinationPath: true, isActive: true },
      });
      assert.deepEqual(szabaly, {
        sourcePath: `/hu/kategoria/${slug("led")}`,
        destinationPath: `/hu/kategoria/${slug("led-lampak")}`,
        isActive: true,
      });
    });

    it("a részleges egyedi index nem enged két primaryt egy terméken", async () => {
      const vilagitas = await prisma.storeCategory.findUniqueOrThrow({
        where: { slug: slug("vilagitas") },
        select: { id: true },
      });
      await assert.rejects(
        prisma.storeCategoryProduct.update({
          where: {
            productId_storeCategoryId: {
              productId,
              storeCategoryId: vilagitas.id,
            },
          },
          data: { isPrimary: true },
        }),
        (error: unknown) =>
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002",
      );
    });
  },
);
