import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Prisma, prisma } from "@acropora/database";
import type { HomepageBlock } from "@acropora/types";

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

    it("HOMEPAGE-INT-REORDER: the band takes the new order, and a list that is not the marked set changes nothing", async () => {
      const before = (await repo.featuredList()).map((row) => row.productId);
      assert.ok(before.length >= 2);
      const reversed = [...before].reverse();
      assert.equal(await repo.orderFeatured(reversed, userId), "ok");
      assert.deepEqual(
        (await repo.featuredList()).map((row) => row.productId),
        reversed,
      );
      assert.equal(
        await repo.orderFeatured(reversed.slice(1), userId),
        "mismatch",
      );
      assert.deepEqual(
        (await repo.featuredList()).map((row) => row.productId),
        reversed,
      );
      const first = (await repo.featuredList())[0];
      assert.ok(first && "imageUrl" in first && "grossPrice" in first);
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

/**
 * THE BLOCKS AND THE FOOTER ON THE REAL DATABASE (2026-10-26). The rule "a
 * save without the field leaves the column alone" lives in the repository's
 * Prisma call, so only the real database can show it. Its own record key, so
 * the main home page is never touched.
 *
 * WHAT TURNS IT RED: today's editor (which sends no blocks) wiping a stored
 * list; `null` stored as JSON null instead of the database NULL.
 */
describe(
  "Homepage blocks and footer, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const key = `hp-int-blocks-${Date.now() % 1_000_000}`;
    const repo = new HomepageContentRepository();
    let userId = "";
    const blocks: HomepageBlock[] = [
      { key: "hero", visible: false },
      { key: "mit-keresel", visible: true },
    ];
    const footer = {
      intro: "<p>Zátony</p>",
      columns: [],
      social: { facebook: null, instagram: null, youtube: null },
      bottomText: "© Acropora",
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      userId = (
        await prisma.user.create({
          data: {
            email: `homepage-blocks-${randomUUID()}@example.invalid`,
            displayName: "Homepage blocks test",
            role: "ADMIN",
          },
        })
      ).id;
    });

    after(async () => {
      await prisma.homepageContent.deleteMany({ where: { key } });
      nincsMaradek([
        {
          nev: "HomepageContent (test key)",
          darab: await prisma.homepageContent.count({ where: { key } }),
        },
      ]);
      if (userId) await prisma.user.delete({ where: { id: userId } });
    });

    it("HOMEPAGE-INT-BLOCKS: a save without blocks and footer keeps them, null clears them", async () => {
      await repo.save(key, { texts: {}, slides: null, blocks, footer }, userId);
      await repo.save(
        key,
        { texts: { "mit.cim": "Új" }, slides: null },
        userId,
      );
      const kept = await repo.find(key);
      assert.deepEqual(kept?.blocks, blocks);
      assert.deepEqual(kept?.footer, footer);
      assert.deepEqual(kept?.texts, { "mit.cim": "Új" });

      await repo.save(
        key,
        { texts: {}, slides: null, blocks: null, footer: null },
        userId,
      );
      const cleared = await prisma.homepageContent.count({
        where: {
          key,
          blocks: { equals: Prisma.DbNull },
          footer: { equals: Prisma.DbNull },
        },
      });
      assert.equal(cleared, 1);
    });

    it("HOMEPAGE-INT-BRANDS: the strip's brand ids keep their order, a save without them keeps them, and the details say which brand is shown", async () => {
      const tag = randomUUID().slice(0, 8);
      const [on, off] = await Promise.all(
        ["be", "ki"].map((nev) =>
          prisma.brand.create({
            data: {
              name: `Sav ${nev} ${tag}`,
              normalizedName: `sav ${nev} ${tag}`,
              slug: `sav-${nev}-${tag}`,
              logoUrl: nev === "be" ? "https://cdn.example/logo.png" : null,
              isActive: nev === "be",
            },
          }),
        ),
      );
      try {
        await repo.save(
          key,
          { texts: {}, slides: null, brandIds: [off!.id, on!.id] },
          userId,
        );
        await repo.save(key, { texts: {}, slides: null }, userId);
        assert.deepEqual((await repo.find(key))?.featuredBrandIds, [
          off!.id,
          on!.id,
        ]);
        const details = await repo.brandsByIds([on!.id, off!.id, "nincs"]);
        assert.deepEqual(
          details
            .map((b) => [b.slug, b.shown, b.logoUrl])
            .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
          [
            [`sav-be-${tag}`, true, "https://cdn.example/logo.png"],
            [`sav-ki-${tag}`, false, null],
          ],
        );
        await repo.save(
          key,
          { texts: {}, slides: null, brandIds: null },
          userId,
        );
        assert.equal(
          await prisma.homepageContent.count({
            where: { key, featuredBrandIds: { equals: Prisma.DbNull } },
          }),
          1,
        );
      } finally {
        await prisma.brand.deleteMany({
          where: { id: { in: [on!.id, off!.id] } },
        });
      }
    });
  },
);
