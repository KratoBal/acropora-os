import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearLeftoverKinds,
  describeLeftoverKinds,
  liveAnimalProductIds,
  type LeftoverKindService,
} from "./medusa-leftover-kind.js";

/*
  A MEGOSZTOTT SZABALY (kartya 4b30b373). MI PIROSIT: a skip (celpont vagy elo allat besorolas) termeket is torli; a
  parositatlan bolti sort bantja; a fajta nelkuli sort torli; az `only` szukitest figyelmen kivul hagyja; az `apply`
  hamis erteke ellenere ir; az elo allat besorolast nem a harom gyoker reszfajabol olvassa.
*/
const sor = (product_id: string, kind: "FISH" | "CORAL" | null) => ({
  id: `sa_${product_id}`,
  product_id,
  pickup_only: true,
  foxpost_forbidden: false,
  is_heavy: false,
  is_frozen: false,
  locker_unsuitable: false,
  livestock_kind: kind,
});

function szolgaltatas(
  rows: ReturnType<typeof sor>[],
  kotesek: Record<string, string>,
) {
  const torlesek: { shop: string; apply: boolean }[] = [];
  const service = {
    listShopShippingAttributes: async () => rows,
    osProductOfShop: async (shop: string) => kotesek[shop] ?? null,
    clearLeftoverKind: async (row: { product_id: string }, apply: boolean) => {
      torlesek.push({ shop: row.product_id, apply });
      return {
        action: apply ? ("applied" as const) : ("planned" as const),
        medusaProductId: row.product_id,
        flags: "élő állat: hal -> a fajta törlése",
      };
    },
  } as unknown as LeftoverKindService;
  return { service, torlesek };
}

describe("a boltban maradt fajta megosztott szabálya", () => {
  const rows = [
    sor("shop-stale", "FISH"),
    sor("shop-live", "CORAL"),
    sor("shop-orphan", "FISH"),
    sor("shop-none", null),
  ];
  const kotesek = {
    "shop-stale": "os-stale",
    "shop-live": "os-live",
    "shop-none": "os-none",
  };

  it("törli, aminek nincs élő állat besorolása; a besorolt, a párosítatlan és a fajta nélküli sorhoz nem nyúl", async () => {
    const { service, torlesek } = szolgaltatas(rows, kotesek);
    const jelentes = await clearLeftoverKinds(service, {
      skip: (id) => id === "os-live",
      osToShop: new Map(),
      apply: true,
    });
    assert.deepEqual(torlesek, [{ shop: "shop-stale", apply: true }]);
    assert.deepEqual(
      jelentes.entries.map((e) => [e.osProductId, e.action]),
      [["os-stale", "applied"]],
    );
    assert.equal(jelentes.rows, 4);
    assert.equal(jelentes.carrying, 3);
    assert.equal(jelentes.unpaired, 1);
  });

  it("apply nélkül csak tervez", async () => {
    const { service, torlesek } = szolgaltatas(rows, kotesek);
    const jelentes = await clearLeftoverKinds(service, {
      skip: () => false,
      osToShop: new Map(),
      apply: false,
    });
    assert.deepEqual(
      torlesek.map((t) => t.apply),
      [false, false],
    );
    assert.ok(jelentes.entries.every((e) => e.action === "planned"));
  });

  it("a SKU-pár is megtalálja az OS-terméket, és az only szűkít", async () => {
    const { service, torlesek } = szolgaltatas([sor("shop-sku", "FISH")], {});
    await clearLeftoverKinds(service, {
      skip: () => false,
      osToShop: new Map([["os-sku", "shop-sku"]]),
      only: ["os-másik"],
      apply: true,
    });
    assert.deepEqual(torlesek, []);
    await clearLeftoverKinds(service, {
      skip: () => false,
      osToShop: new Map([["os-sku", "shop-sku"]]),
      only: ["os-sku"],
      apply: true,
    });
    assert.deepEqual(torlesek, [{ shop: "shop-sku", apply: true }]);
  });

  it("a jelentés kimondja, mit látott és mit tett", () => {
    const szoveg = describeLeftoverKinds(
      {
        rows: 10,
        carrying: 3,
        unpaired: 1,
        entries: [
          {
            osProductId: "os-1",
            medusaProductId: "prod_1",
            flags: "x",
            action: "applied",
          },
        ],
      },
      true,
    );
    assert.match(szoveg, /os-1: most állítottuk be -> prod_1 \(x\)/);
    assert.match(
      szoveg,
      /a bolt 10 szállítási-jellemző sort adott, 3-n áll fajta, 1 törölve, 1 OS-termék nélkül/,
    );
  });
});

describe("az élő állat besorolású termékek", () => {
  it("a három gyökér részfájába tartozó besorolás bármelyik sora számít, a többi nem", async () => {
    const lekerdezesek: unknown[] = [];
    const ids = await liveAnimalProductIds({
      category: {
        findMany: async () => [
          { id: "gy1", name: "Korallok", parentId: null },
          { id: "gy1a", name: "SPS", parentId: "gy1" },
          { id: "mu1", name: "Technika", parentId: null },
        ],
      },
      productCategory: {
        findMany: async (args: unknown) => {
          lekerdezesek.push(args);
          return [
            { productId: "os-a", categoryId: "gy1a" },
            { productId: "os-b", categoryId: "gy1" },
          ];
        },
      },
    });
    assert.deepEqual([...ids].sort(), ["os-a", "os-b"]);
    const kerdes = lekerdezesek[0] as {
      where: { categoryId: { in: string[] } };
    };
    assert.deepEqual([...kerdes.where.categoryId.in].sort(), ["gy1", "gy1a"]);
  });

  it("élő állat kategória nélkül üres halmaz, és nem kérdez rá a besorolásokra", async () => {
    let hivas = 0;
    const ids = await liveAnimalProductIds({
      category: {
        findMany: async () => [{ id: "mu1", name: "Technika", parentId: null }],
      },
      productCategory: {
        findMany: async () => {
          hivas += 1;
          return [];
        },
      },
    });
    assert.equal(ids.size, 0);
    assert.equal(hivas, 0);
  });
});
