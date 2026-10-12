import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { SeoLandingRepository } from "./seo-landing.repository.js";
import { SeoLandingService } from "./seo-landing.service.js";

/**
 * THE LANDING PAGE STORE ON THE REAL SCHEMA (SEO P1-14). The live slug's
 * unique index, the shared uniqueness with `SlugHistory`, the slug change's
 * history row and 301 in ONE transaction, and taking back an own old slug only
 * meet Postgres here.
 *
 * WHAT TURNS IT RED: a renamed page leaving no history row or no 301; an old
 * slug given to another page; a page unable to take back its own old slug
 * (the history row would collide with the live one); a failed write leaving
 * half of itself behind.
 */
const gate = integrationDatabaseGate(process.env);

describe(
  "SEO landing pages, on the database",
  { skip: gate.mode === "skip" },
  () => {
    const suffix = `${Date.now() % 1_000_000}`;
    const slug = (name: string) => `lp-int-${suffix}-${name}`;
    let categoryId = "";
    let userId = "";
    const service = new SeoLandingService(new SeoLandingRepository());
    const body = (s: string) => ({
      slug: s,
      title: "Integrációs landing",
      seoTitle: null,
      metaDescription: null,
      intro: null,
      filter: { storeCategoryIds: [categoryId], brandIds: [] },
      isPublished: false,
    });

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();
      categoryId = (
        await prisma.storeCategory.create({
          data: { name: `LP int ${suffix}`, slug: slug("kategoria") },
        })
      ).id;
      userId = (
        await prisma.user.create({
          data: {
            email: `seo-landing-${randomUUID()}@example.invalid`,
            displayName: "Landing test",
            role: "ADMIN",
          },
        })
      ).id;
    });

    after(async () => {
      await removeLeftovers();
      if (userId) await prisma.user.delete({ where: { id: userId } });
    });

    async function removeLeftovers() {
      const prefix = `lp-int-${suffix}-`;
      const pages = await prisma.seoLandingPage.findMany({
        where: { slug: { startsWith: prefix } },
        select: { id: true },
      });
      const ids = pages.map((p) => p.id);
      await prisma.urlRedirect.deleteMany({
        where: { sourcePath: { startsWith: `/hu/valogatas/${prefix}` } },
      });
      await prisma.slugHistory.deleteMany({
        where: { entityType: "LANDING_PAGE", slug: { startsWith: prefix } },
      });
      await prisma.seoLandingPage.deleteMany({ where: { id: { in: ids } } });
      await prisma.storeCategory.deleteMany({
        where: { slug: { startsWith: prefix } },
      });
      nincsMaradek([
        {
          nev: "SeoLandingPage (slug)",
          darab: await prisma.seoLandingPage.count({
            where: { slug: { startsWith: prefix } },
          }),
        },
        {
          nev: "UrlRedirect (/hu/valogatas/)",
          darab: await prisma.urlRedirect.count({
            where: { sourcePath: { startsWith: `/hu/valogatas/${prefix}` } },
          }),
        },
      ]);
    }

    it("LANDING-INT-RENAME: history row and 301 together; the old slug stays its own", async () => {
      const page = await service.create(body(slug("a")));
      await service.update(page.id, body(slug("b")), userId);

      const history = await prisma.slugHistory.findUnique({
        where: {
          entityType_slug: { entityType: "LANDING_PAGE", slug: slug("a") },
        },
      });
      assert.equal(history?.entityId, page.id);
      const rule = await prisma.urlRedirect.findFirst({
        where: { sourcePath: `/hu/valogatas/${slug("a")}` },
      });
      assert.equal(rule?.destinationPath, `/hu/valogatas/${slug("b")}`);
      assert.equal(rule?.isActive, true);

      const other = await service.create(body(slug("c")));
      await assert.rejects(
        service.update(other.id, body(slug("a")), userId),
        ConflictException,
      );
    });

    it("LANDING-INT-TAKE-BACK: the page takes back its own old slug, the 301 on it goes", async () => {
      const page = await service.create(body(slug("d")));
      await service.update(page.id, body(slug("e")), userId);
      const back = await service.update(page.id, body(slug("d")), userId);
      assert.equal(back.slug, slug("d"));
      assert.equal(
        await prisma.slugHistory.count({
          where: { entityType: "LANDING_PAGE", slug: slug("d") },
        }),
        0,
      );
      const onLive = await prisma.urlRedirect.findFirst({
        where: { sourcePath: `/hu/valogatas/${slug("d")}`, isActive: true },
      });
      assert.equal(onLive, null);
    });
  },
);
