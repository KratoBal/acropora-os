import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { HomepageContentRepository } from "./homepage-content.repository.js";
import { HOMEPAGE_FEATURED_MAX } from "./homepage-content.service.js";

/**
 * THE FEATURED BAND'S LIMIT ON THE REAL DATABASE (barracuda, #1723). The
 * limit is "count, then create": without a lock two concurrent marks both see
 * eleven and both create, and the shop's validator (at most twelve) then
 * refuses the WHOLE home page record. The advisory lock in the repository makes
 * the check and the write one step; this suite is the only place that can show
 * it, because it needs concurrent transactions on real Postgres.
 *
 * WHAT TURNS IT RED: the lock removed (more than twelve rows), a mark of an
 * already marked product counted twice, an unknown product accepted.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "Homepage featured band, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const prefix = `hp-int-${suffix}-`;
    const repo = new HomepageContentRepository();
    const ids: string[] = [];
    let userId = "";

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await cleanup();
      userId = (
        await prisma.user.create({
          data: {
            email: `homepage-${randomUUID()}@example.invalid`,
            displayName: "Homepage test",
            role: "ADMIN",
          },
        })
      ).id;
      for (let i = 0; i < 16; i++)
        ids.push(
          (await prisma.product.create({ data: { name: `${prefix}${i}` } })).id,
        );
    });

    after(async () => {
      await cleanup();
      if (userId) await prisma.user.delete({ where: { id: userId } });
    });

    async function cleanup() {
      await prisma.product.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      nincsMaradek([
        {
          nev: "Product (name prefix)",
          darab: await prisma.product.count({
            where: { name: { startsWith: prefix } },
          }),
        },
      ]);
    }

    it("HOMEPAGE-INT-LIMIT: concurrent marks never exceed twelve, and unmarking frees a place", async () => {
      const baseline = await prisma.homepageFeaturedProduct.count();
      assert.ok(
        baseline <= HOMEPAGE_FEATURED_MAX - 1,
        "the test database has room",
      );
      const fill = HOMEPAGE_FEATURED_MAX - 1 - baseline;
      for (let i = 0; i < fill; i++)
        assert.equal(
          await repo.setFeatured(ids[i]!, true, userId, HOMEPAGE_FEATURED_MAX),
          "ok",
        );
      // one place left, five concurrent marks: exactly one wins
      const results = await Promise.all(
        ids
          .slice(fill, fill + 5)
          .map((id) =>
            repo.setFeatured(id, true, userId, HOMEPAGE_FEATURED_MAX),
          ),
      );
      assert.equal(results.filter((r) => r === "ok").length, 1);
      assert.equal(results.filter((r) => r === "full").length, 4);
      assert.equal(
        await prisma.homepageFeaturedProduct.count(),
        HOMEPAGE_FEATURED_MAX,
      );
      // an already marked product is never "full", and unmarking frees a place
      assert.equal(
        await repo.setFeatured(ids[0]!, true, userId, HOMEPAGE_FEATURED_MAX),
        "ok",
      );
      assert.equal(
        await repo.setFeatured(ids[0]!, false, userId, HOMEPAGE_FEATURED_MAX),
        "ok",
      );
      assert.equal(
        await repo.setFeatured(ids[15]!, true, userId, HOMEPAGE_FEATURED_MAX),
        "ok",
      );
      assert.equal(
        await prisma.homepageFeaturedProduct.count(),
        HOMEPAGE_FEATURED_MAX,
      );
    });

    it("HOMEPAGE-INT-ORDER: the list follows the marking order and carries the product's name", async () => {
      const list = await repo.featuredList();
      const mine = list.filter((row) => row.name.startsWith(prefix));
      assert.ok(mine.length > 0);
      const orders = list.map((row) => row.sortOrder);
      assert.deepEqual(
        orders,
        [...orders].sort((a, b) => a - b),
      );
    });

    it("HOMEPAGE-INT-UNKNOWN: an unknown product is refused, and deleting a product removes its marker", async () => {
      assert.equal(
        await repo.setFeatured(
          `nincs-${suffix}`,
          true,
          userId,
          HOMEPAGE_FEATURED_MAX,
        ),
        "unknown-product",
      );
      const marked = await prisma.homepageFeaturedProduct.findFirst({
        where: { product: { name: { startsWith: prefix } } },
        select: { productId: true },
      });
      assert.ok(marked);
      await prisma.product.delete({ where: { id: marked.productId } });
      assert.equal(
        await prisma.homepageFeaturedProduct.count({
          where: { productId: marked.productId },
        }),
        0,
      );
    });
  },
);
