import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { ProductRepository } from "./product.repository.js";

/**
 * THE PRODUCT LIST'S SHIPPING COLUMN AND FILTER, on a real Postgres (card a82ed229, PR 2b). WHAT TURNS THIS RED: a
 * flag filter that lets in a product without the flag, or one nobody has looked at; `none` that lets in a looked-at
 * product; the column that says "none applies" for a product nobody has looked at (null and [] are two answers); a
 * where or include field the database refuses (a select with a made-up field compiles).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = `SHIPLIST-${Date.now() % 1_000_000}`;
const ids: Record<string, string> = {};
const repository = new ProductRepository();

const flags = {
  pickupOnly: false,
  foxpostForbidden: false,
  isHeavy: false,
  isFrozen: false,
};

describe(
  "the product list's shipping column and filter",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await prisma.product.deleteMany({
        where: { name: { startsWith: "SHIPLIST-" } },
      });
      const product = async (key: string) =>
        (
          await prisma.product.create({
            data: { name: `${PREFIX} ${key}`, isActive: true },
            select: { id: true },
          })
        ).id;
      ids.heavyLocker = await product("heavyLocker");
      ids.looked = await product("looked");
      ids.never = await product("never");
      await prisma.productShippingProfile.create({
        data: {
          productId: ids.heavyLocker,
          ...flags,
          isHeavy: true,
          lockerUnsuitable: true,
        },
      });
      await prisma.productShippingProfile.create({
        data: { productId: ids.looked, ...flags },
      });
      // 2d: UNAS denies Foxpost on two of them; one was allowed by hand, one agrees by hand
      const foxpostDenied = {
        ShippingMethods: {
          Denied: { Method: [{ Name: "Foxpost csomagautomaták" }] },
        },
      };
      ids.manualDiff = await product("manualDiff");
      ids.manualSame = await product("manualSame");
      ids.manualNoUnas = await product("manualNoUnas");
      for (const key of ["manualDiff", "manualSame"])
        await prisma.unasProductSnapshot.create({
          data: { productId: ids[key]!, rawPayload: foxpostDenied },
        });
      await prisma.productShippingProfile.create({
        data: {
          productId: ids.manualDiff,
          ...flags,
          foxpostForbiddenSource: "MANUAL",
        },
      });
      await prisma.productShippingProfile.create({
        data: {
          productId: ids.manualSame,
          ...flags,
          foxpostForbidden: true,
          foxpostForbiddenSource: "MANUAL",
        },
      });
      await prisma.productShippingProfile.create({
        data: {
          productId: ids.manualNoUnas,
          ...flags,
          isHeavy: true,
          isHeavySource: "MANUAL",
        },
      });
    });

    after(async () => {
      if (gate.mode === "run")
        await prisma.product.deleteMany({
          where: { name: { startsWith: "SHIPLIST-" } },
        });
    });

    const listed = async (
      shipping?:
        "isHeavy" | "lockerUnsuitable" | "isFrozen" | "none" | "unasDiff",
    ) =>
      (
        await repository.list({
          page: 1,
          pageSize: 100,
          search: PREFIX,
          ...(shipping ? { shipping } : {}),
        } as never)
      ).items;

    it("the column: the set flags, [] for looked at and none applies, null for never looked at", async () => {
      const items = await listed();
      const by = new Map(items.map((item) => [item.id, item.shippingFlags]));
      assert.deepEqual(by.get(ids.heavyLocker!), [
        "isHeavy",
        "lockerUnsuitable",
      ]);
      assert.deepEqual(by.get(ids.looked!), []);
      assert.equal(by.get(ids.never!), null);
    });

    it("the filter: a flag keeps only the products with it; none keeps only those never looked at", async () => {
      const names = async (shipping: Parameters<typeof listed>[0]) =>
        (await listed(shipping)).map((item) => item.id).sort();
      assert.deepEqual(
        await names("isHeavy"),
        [ids.heavyLocker, ids.manualNoUnas].sort(),
      );
      assert.deepEqual(await names("lockerUnsuitable"), [ids.heavyLocker]);
      assert.deepEqual(await names("isFrozen"), []);
      assert.deepEqual(await names("none"), [ids.never]);
    });

    it("the UNAS difference filter: only a hand-set flag that UNAS contradicts today (2d)", async () => {
      const found = (await listed("unasDiff")).map((item) => item.id);
      // not the hand-set flag that agrees with UNAS, not the one without UNAS data, not the UNAS-sourced rows
      assert.deepEqual(found, [ids.manualDiff]);
    });
  },
);
