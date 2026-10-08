import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { main } from "./redirect-backfill.cli.js";
import { planRedirectBackfill } from "./redirect-backfill.js";

/**
 * A RÉGI UNAS-TERMÉKCÍMEK BACKFILLJE (SEO P0 PR 6). MI PIROSIT: a /spd/ vagy a
 * perjeles cím csonkán megy át; a régi cím nélküli termék szabályt kap; egy
 * második futás újra ír; egy más célú meglévő szabály felülíródik; a szárazfutás
 * ír; láncnál vagy elutasításnál az `--apply` mégis ír.
 */
const SHOP = "https://shop.acropora.hu";

describe("planRedirectBackfill", () => {
  it("a /spd/ cím és a perjeles SefUrl a teljes útjával; a régi cím nélküli kimarad", async () => {
    const { store, report } = await planRedirectBackfill(
      [
        { id: "c1", unasUrl: `${SHOP}/Tropic-Pro-Reef`, webshopSlug: "tp" },
        {
          id: "c2",
          unasUrl: `${SHOP}/spd/156161/Nyos-Reef-Putty-200g`,
          webshopSlug: "nyos",
        },
        { id: "c3", unasUrl: `${SHOP}/Pumpa-3000-liter/ora`, webshopSlug: "p" },
        { id: "c4", unasUrl: null, webshopSlug: "nincs" },
        { id: "c5", unasUrl: `${SHOP}/Slug-Nelkul`, webshopSlug: null },
      ],
      [],
    );
    assert.deepEqual(
      store.created().map((r) => `${r.sourcePath} -> ${r.destinationPath}`),
      [
        "/Tropic-Pro-Reef -> /hu/termek/tp",
        "/spd/156161/Nyos-Reef-Putty-200g -> /hu/termek/nyos",
        "/Pumpa-3000-liter/ora -> /hu/termek/p",
      ],
    );
    assert.equal(store.created()[0]!.reason, "UNAS_PRODUCT");
    assert.equal(store.created()[0]!.entityId, "c1");
    assert.equal(report.created, 3);
    assert.equal(report.spdPaths, 1);
    assert.equal(report.withoutOldUrl, 1);
    assert.deepEqual(report.withoutWebshopSlug, ["c5"]);
    assert.deepEqual(report.invariantViolations, []);
  });

  it("idempotens: a már ugyanoda mutató szabály nem íródik újra", async () => {
    const { store, report } = await planRedirectBackfill(
      [{ id: "c1", unasUrl: `${SHOP}/Pumpa/`, webshopSlug: "pumpa" }],
      [
        {
          id: "r1",
          sourcePath: "/Pumpa",
          destinationPath: "/hu/termek/pumpa",
          isActive: true,
        },
      ],
    );
    assert.equal(report.unchanged, 1);
    assert.deepEqual(store.created(), []);
    assert.deepEqual(store.updated(), []);
  });

  it("a /spd/ számláló csak az ÚJ szabályokat számolja (a második futás 0)", async () => {
    const { report } = await planRedirectBackfill(
      [{ id: "c1", unasUrl: `${SHOP}/spd/1/Nyos`, webshopSlug: "nyos" }],
      [
        {
          id: "r1",
          sourcePath: "/spd/1/Nyos",
          destinationPath: "/hu/termek/nyos",
          isActive: true,
        },
      ],
    );
    assert.equal(report.unchanged, 1);
    assert.equal(report.spdPaths, 0);
  });

  it("egy más célú meglévő szabály a jelentésbe megy, felülírás nélkül", async () => {
    const { store, report } = await planRedirectBackfill(
      [{ id: "c1", unasUrl: `${SHOP}/Pumpa`, webshopSlug: "pumpa" }],
      [
        {
          id: "r1",
          sourcePath: "/Pumpa",
          destinationPath: "/hu/kategoria/pumpak",
          isActive: true,
        },
      ],
    );
    assert.deepEqual(report.conflicts, [
      { productId: "c1", source: "/Pumpa", existing: "/hu/kategoria/pumpak" },
    ]);
    assert.deepEqual(store.updated(), []);
  });

  it("két, csak betűméretben eltérő régi cím: az egyik elutasítva", async () => {
    const { report } = await planRedirectBackfill(
      [
        { id: "c1", unasUrl: `${SHOP}/Pumpa`, webshopSlug: "a" },
        { id: "c2", unasUrl: `${SHOP}/pumpa`, webshopSlug: "b" },
      ],
      [],
    );
    assert.equal(report.created, 1);
    assert.deepEqual(
      report.refused.map((r) => [r.productId, r.kind]),
      [["c2", "case-collision"]],
    );
  });
});

describe("a redirect-backfill parancs", () => {
  function adatbazis(
    termekek: { id: string; unas: string | null; slug: string | null }[],
    meglevo: {
      id: string;
      sourcePath: string;
      destinationPath: string;
      isActive: boolean;
    }[] = [],
  ) {
    const irasok: unknown[] = [];
    return {
      irasok,
      db: {
        product: {
          findMany: async () =>
            termekek.map((t) => ({
              id: t.id,
              channelListings: [
                { channel: "UNAS", productUrl: t.unas, slug: null },
                { channel: "WEBSHOP", productUrl: null, slug: t.slug },
              ],
            })),
        },
        urlRedirect: {
          findMany: async () => meglevo,
          createMany: (args: unknown) => (
            irasok.push(["createMany", args]),
            args
          ),
          update: (args: unknown) => (irasok.push(["update", args]), args),
        },
        $transaction: async (ops: unknown[]) => {
          irasok.push(["transaction", ops.length]);
          return ops;
        },
      },
    };
  }
  const csend = { stdout: () => {}, stderr: () => {} };

  it("alapból szárazfutás: nem ír", async () => {
    const { db, irasok } = adatbazis([
      { id: "c1", unas: `${SHOP}/Pumpa`, slug: "pumpa" },
    ]);
    assert.equal(await main([], csend, db as never), 0);
    assert.deepEqual(irasok, []);
  });

  it("--apply egy tranzakcióban írja az új szabályt és a lánc átírását", async () => {
    const { db, irasok } = adatbazis(
      [{ id: "c1", unas: `${SHOP}/Pumpa`, slug: "pumpa" }],
      [
        {
          id: "r1",
          sourcePath: "/regi-link",
          destinationPath: "/Pumpa",
          isActive: true,
        },
      ],
    );
    assert.equal(await main(["--apply"], csend, db as never), 0);
    assert.deepEqual(irasok, [
      [
        "createMany",
        {
          data: [
            {
              sourcePath: "/Pumpa",
              sourcePathLower: "/pumpa",
              destinationPath: "/hu/termek/pumpa",
              destinationPathLower: "/hu/termek/pumpa",
              reason: "UNAS_PRODUCT",
              entityType: "PRODUCT",
              entityId: "c1",
              isActive: true,
              createdById: null,
            },
          ],
        },
      ],
      [
        "update",
        {
          where: { id: "r1" },
          data: {
            destinationPath: "/hu/termek/pumpa",
            destinationPathLower: "/hu/termek/pumpa",
          },
        },
      ],
      ["transaction", 2],
    ]);
  });

  it("egy második futás nem ír új sort", async () => {
    const { db, irasok } = adatbazis(
      [{ id: "c1", unas: `${SHOP}/Pumpa`, slug: "pumpa" }],
      [
        {
          id: "r1",
          sourcePath: "/Pumpa",
          destinationPath: "/hu/termek/pumpa",
          isActive: true,
        },
      ],
    );
    assert.equal(await main(["--apply"], csend, db as never), 0);
    assert.deepEqual(irasok, [["transaction", 0]]);
  });

  it("elutasított szabálynál az --apply nem ír", async () => {
    const { db, irasok } = adatbazis([
      { id: "c1", unas: `${SHOP}/Pumpa`, slug: "a" },
      { id: "c2", unas: `${SHOP}/pumpa`, slug: "b" },
    ]);
    assert.equal(await main(["--apply"], csend, db as never), 1);
    assert.deepEqual(irasok, []);
  });

  it("ismeretlen kapcsolóra nem fut", async () => {
    const { db, irasok } = adatbazis([]);
    assert.equal(await main(["--aply"], csend, db as never), 1);
    assert.deepEqual(irasok, []);
  });
});
