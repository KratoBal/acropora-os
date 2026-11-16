import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { nincsMaradek } from "../common/takaritas-leltar.js";
import { integrationDatabaseGate } from "../common/integration-database.js";
import { ProductRepository } from "./product.repository.js";

const gate = integrationDatabaseGate(process.env);
const runIntegration = gate.mode !== "skip";

/**
 * THE HUSBANDRY FILTER AND STATE OF THE PRODUCT LIST, MEASURED ON THE DATABASE (V2.2 S6, card d2fc06e7).
 *
 * What this proves: the live-animal restriction (a live root with no parent, found at depth 0 and at depth 2, and NOT a
 * look-alike name under another tree), "verified" is the stamp, "unverified" is the stamp-less AND the no-datasheet-row product, and the
 * row's own state agrees with the filter. What it does NOT prove: that any staging or production data is in order.
 */
const PREFIX = `husblist-${Date.now()}`;

describe(
  "husbandry filter of the product list, on the database",
  { skip: !runIntegration },
  () => {
    const repository = new ProductRepository();
    const categoryIds: string[] = [];
    const names = {
      verifiedFish: `${PREFIX} verified fish`,
      unverifiedFish: `${PREFIX} stamp-less fish`,
      noSheetCoral: `${PREFIX} no-sheet coral`,
      deepCoral: `${PREFIX} deep coral`,
      accessory: `${PREFIX} accessory`,
      lookAlike: `${PREFIX} look-alike`,
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      const make = async (
        name: string,
        slug: string,
        parentId: string | null,
      ) => {
        const category = await prisma.category.create({
          data: { name, slug: `${PREFIX}-${slug}`, parentId },
          select: { id: true },
        });
        categoryIds.push(category.id);
        return category.id;
      };
      const fish = await make("Halak", "halak", null);
      const corals = await make("Korallok", "korallok", null);
      const sps = await make("SPS", "sps", corals);
      const acropora = await make("Acropora", "acropora", sps);
      const filters = await make("Szűrők", "szurok", null);
      // a look-alike: a subcategory NAMED like a live root, under another tree
      const lookAlike = await make("Halak", "halak-masik", filters);

      const product = async (
        name: string,
        categoryId: string,
        sheet?: { ellenorizveAt: Date | null; stingOrVenom?: boolean },
      ) => {
        const created = await prisma.product.create({
          data: { name, isActive: true },
          select: { id: true },
        });
        await prisma.productCategory.create({
          data: {
            productId: created.id,
            categoryId,
            isPrimary: true,
            source: "MANUAL",
          },
        });
        if (sheet)
          await prisma.productDatasheet.create({
            data: { productId: created.id, ...sheet },
          });
        return created.id;
      };
      await product(names.verifiedFish, fish, { ellenorizveAt: new Date() });
      await product(names.unverifiedFish, fish, { ellenorizveAt: null });
      await product(names.noSheetCoral, corals);
      await product(names.deepCoral, acropora, {
        ellenorizveAt: null,
        stingOrVenom: true,
      });
      await product(names.accessory, filters);
      await product(names.lookAlike, lookAlike);
    });

    after(async () => {
      await prisma.product.deleteMany({
        where: { name: { startsWith: PREFIX } },
      });
      await prisma.category.deleteMany({
        where: { id: { in: [...categoryIds].reverse() } },
      });
      nincsMaradek([
        {
          nev: "the suite's products survived the cleanup",
          darab: await prisma.product.count({
            where: { name: { startsWith: PREFIX } },
          }),
        },
        {
          nev: "the suite's categories survived the cleanup",
          darab: await prisma.category.count({
            where: { slug: { startsWith: PREFIX } },
          }),
        },
      ]);
      await prisma.$disconnect();
    });

    const listed = async (husbandry?: "verified" | "unverified") =>
      (
        await repository.list({
          page: 1,
          pageSize: 50,
          search: PREFIX,
          husbandry,
        })
      ).items;

    it("verified: only the stamped live animal", async () => {
      const items = await listed("verified");
      assert.deepEqual(
        items.map((item) => item.name),
        [names.verifiedFish],
      );
    });

    it("unverified: the stamp-less AND the no-sheet live animals, at any depth; never an accessory or a look-alike name under another tree", async () => {
      const items = await listed("unverified");
      assert.deepEqual(
        items.map((item) => item.name).sort(),
        [names.deepCoral, names.noSheetCoral, names.unverifiedFish].sort(),
      );
    });

    it("the unfiltered list carries each row's own state, null for the products that are not live animals, and agrees with the filter", async () => {
      const items = await listed();
      assert.equal(items.length, 6);
      const byName = new Map(items.map((item) => [item.name, item.husbandry]));
      assert.equal(byName.get(names.accessory), null);
      assert.equal(byName.get(names.lookAlike), null);
      assert.equal(byName.get(names.verifiedFish)?.verified, true);
      assert.equal(byName.get(names.unverifiedFish)?.verified, false);
      assert.equal(byName.get(names.noSheetCoral)?.verified, false);
      assert.equal(byName.get(names.deepCoral)?.verified, false);
      // the stored sting or venom is the row's hazard; no other row has one
      assert.equal(byName.get(names.deepCoral)?.hazard, true);
      assert.equal(byName.get(names.verifiedFish)?.hazard, false);
      assert.equal(byName.get(names.noSheetCoral)?.hazard, false);
      // the missing count is a number for a live animal
      assert.equal(typeof byName.get(names.deepCoral)?.missing, "number");
    });
  },
);
