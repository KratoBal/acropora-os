import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../../common/integration-database.js";
import { nincsMaradek } from "../../common/takaritas-leltar.js";
import { PrismaWebshopSlugStore } from "./webshop-slug.repository.js";
import { WebshopSlugService } from "./webshop-slug.service.js";

/**
 * A WEBSHOP-SLUG A VALÓDI SÉMÁN (SEO P0 PR 5). A részleges egyedi index és a
 * `SlugHistory` egyedi kulcsa csak itt találkozik Postgresszel.
 *
 * MI PIROSIT: két WEBSHOP-sor ugyanazzal a sluggal megfér; a UNAS-sor slugja
 * ütközik a WEBSHOP-éval (más csatorna); a kézi csere nem írja a régit előzménybe,
 * vagy nem ír átirányítást a régi címről (PR 6).
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "WEBSHOP-SLUG-INT-";

describe("Webshop-slug, adatbázison", { skip: gate.mode === "skip" }, () => {
  const suffix = Date.now() % 1_000_000;
  const ids: string[] = [];

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
    // két termék UGYANAZZAL a névvel: a második ütközik
    for (let i = 0; i < 2; i++) {
      const p = await prisma.product.create({
        data: { name: `${PREFIX}Pumpa ${suffix}` },
        select: { id: true },
      });
      ids.push(p.id);
    }
  });

  after(removeLeftovers);

  async function removeLeftovers() {
    const mine = { product: { name: { startsWith: PREFIX } } };
    const termekek = await prisma.product.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    await prisma.slugHistory.deleteMany({
      where: {
        entityType: "PRODUCT",
        entityId: { in: termekek.map((t) => t.id) },
      },
    });
    await prisma.urlRedirect.deleteMany({
      where: { entityId: { in: termekek.map((t) => t.id) } },
    });
    await prisma.channelListing.deleteMany({ where: mine });
    await prisma.product.deleteMany({
      where: { name: { startsWith: PREFIX } },
    });
    nincsMaradek([
      {
        nev: "UrlRedirect (entityId)",
        darab: await prisma.urlRedirect.count({
          where: { entityId: { in: termekek.map((t) => t.id) } },
        }),
      },
      {
        nev: "ChannelListing",
        darab: await prisma.channelListing.count({ where: mine }),
      },
      {
        nev: "Product",
        darab: await prisma.product.count({
          where: { name: { startsWith: PREFIX } },
        }),
      },
    ]);
  }

  it("a részleges egyedi index: két WEBSHOP-sor nem viselheti ugyanazt a slugot, egy UNAS-sor igen", async () => {
    const slug = `pumpa-int-${suffix}`;
    await prisma.channelListing.create({
      data: { productId: ids[0]!, channel: "WEBSHOP", slug },
    });
    await assert.rejects(
      prisma.channelListing.create({
        data: { productId: ids[1]!, channel: "WEBSHOP", slug },
      }),
    );
    await prisma.channelListing.create({
      data: { productId: ids[1]!, channel: "UNAS", slug },
    });
    await prisma.channelListing.deleteMany({
      where: { productId: { in: ids } },
    });
  });

  it("a szolgáltatás a valódi tárolón: első slug, ütközésnél utótag (változat nélkül az azonosító), kézi csere előzménnyel", async () => {
    const s = new WebshopSlugService(new PrismaWebshopSlugStore());
    const elso = await s.webshopSlug(ids[0]!);
    assert.equal(elso, `webshop-slug-int-pumpa-${suffix}`);
    const masodik = await s.webshopSlug(ids[1]!);
    assert.notEqual(masodik, elso);
    assert.ok(masodik.startsWith(`${elso}-`), masodik);

    await s.changeSlug(ids[0]!, `uj-pumpa-int-${suffix}`, null as never);
    const regi = await prisma.slugHistory.findUnique({
      where: { entityType_slug: { entityType: "PRODUCT", slug: elso } },
      select: { entityId: true },
    });
    assert.equal(regi?.entityId, ids[0]);

    // PR 6: a régi cím átirányítása ugyanabban a tranzakcióban
    const szabaly = await prisma.urlRedirect.findUnique({
      where: { sourcePathLower: `/hu/termek/${elso}` },
      select: { destinationPath: true, reason: true, entityId: true },
    });
    assert.deepEqual(szabaly, {
      destinationPath: `/hu/termek/uj-pumpa-int-${suffix}`,
      reason: "SLUG_CHANGE",
      entityId: ids[0],
    });
  });
});
