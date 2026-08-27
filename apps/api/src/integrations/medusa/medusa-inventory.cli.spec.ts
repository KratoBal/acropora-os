import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { InventoryProjectionReport } from "./medusa-inventory-projection.service.js";
import {
  describeInventory,
  resolveTargets,
  type InventoryCliDatabase,
} from "./medusa-inventory.cli.js";

/**
 * A PARANCS KÉT DOLGA, adatbázis nélkül: KIT vetítünk, és MIT ír ki.
 *
 * A „kit" nem infrastruktúra: a gazda-ellenőrzés és a készletsor
 * megválasztása szabály. A brief 13. tesztje („UNAS-owned mastership nem
 * változik") ezt kéri számon, és ha a szabály a parancs törzsébe lenne írva,
 * csak éles adatbázissal lehetne megnézni.
 */

const decimal = (value: string) => new Prisma.Decimal(value);

function database(options: {
  variants?: { id: string; sku: string; productId: string }[];
  products?: { id: string; catalogAuthority: string | null }[];
  stock?: {
    variantId: string;
    onHand: Prisma.Decimal;
    reserved: Prisma.Decimal | null;
  }[];
}) {
  const queries: Record<string, unknown>[] = [];
  const db = {
    productVariant: {
      async findMany(args: Record<string, unknown>) {
        queries.push({ table: "productVariant", ...args });
        return options.variants ?? [];
      },
    },
    product: {
      async findMany(args: Record<string, unknown>) {
        queries.push({ table: "product", ...args });
        return (
          options.products ?? [
            { id: "prod-os-1", catalogAuthority: "ACROPORA" },
          ]
        );
      },
    },
    stockItem: {
      async findMany(args: Record<string, unknown>) {
        queries.push({ table: "stockItem", ...args });
        return options.stock ?? [];
      },
    },
    warehouse: {
      async findFirst() {
        return { id: "wh_1", name: "Fő raktár" };
      },
      async create() {
        throw new Error("nem kellene raktárt létrehozni");
      },
    },
  } as unknown as InventoryCliDatabase;
  return { db, queries };
}

const VARIANT = { id: "var_1", sku: "teszt0001", productId: "prod-os-1" };

describe("Készlet-parancs: kit vetítünk", () => {
  it("cikkszámból megtalálja a változatot és a készletsort", async () => {
    const { db } = database({
      variants: [VARIANT],
      stock: [
        { variantId: "var_1", onHand: decimal("5"), reserved: decimal("2") },
      ],
    });
    const resolved = await resolveTargets("sku:teszt0001", "wh_1", db);

    assert.ok(Array.isArray(resolved));
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.sku, "teszt0001");
    assert.equal(resolved[0]!.onHand.toString(), "5");
    assert.equal(resolved[0]!.reserved.toString(), "2");
    assert.equal(resolved[0]!.missingRow, false);
  });

  /**
   * UGYANAZ A KÉSZLETSOR, amit ma az UNAS-út és a POS olvas: a fő raktár,
   * hely és tétel NÉLKÜLI sora. Egy másik olvasás itt csendben egy MÁSIK
   * készletfogalmat vezetne be.
   */
  it("a fő raktár hely és tétel nélküli sorát olvassa", async () => {
    const { db, queries } = database({ variants: [VARIANT] });
    await resolveTargets("sku:teszt0001", "wh_1", db);

    const stockQuery = queries.find((entry) => entry.table === "stockItem");
    assert.ok(stockQuery);
    assert.deepEqual((stockQuery as { where: unknown }).where, {
      warehouseId: "wh_1",
      locationId: null,
      lotId: null,
      variantId: { in: ["var_1"] },
    });
  });

  /** A brief 13. tesztje. */
  it("UNAS-gazdájú terméket NEM vetít", async () => {
    const { db, queries } = database({
      variants: [VARIANT],
      products: [{ id: "prod-os-1", catalogAuthority: "UNAS" }],
    });
    const resolved = await resolveTargets("sku:teszt0001", "wh_1", db);

    assert.ok(!Array.isArray(resolved));
    assert.match(resolved.error, /nem az Acropora OS/);
    assert.ok(
      !queries.some((entry) => entry.table === "stockItem"),
      "a készletet el sem olvassuk: a gazda kérdése előbb dől el",
    );
  });

  it("ismeretlen gazda ugyanúgy kizár (fail-closed)", async () => {
    const { db } = database({
      variants: [VARIANT],
      products: [{ id: "prod-os-1", catalogAuthority: null }],
    });
    const resolved = await resolveTargets("sku:teszt0001", "wh_1", db);

    assert.ok(!Array.isArray(resolved));
    assert.match(resolved.error, /ismeretlen/);
  });

  it("hiányzó készletsor nullát jelent, és a parancs kimondja", async () => {
    const { db } = database({ variants: [VARIANT], stock: [] });
    const resolved = await resolveTargets("sku:teszt0001", "wh_1", db);

    assert.ok(Array.isArray(resolved));
    assert.equal(resolved[0]!.onHand.toString(), "0");
    assert.equal(resolved[0]!.missingRow, true);
  });

  it("nincs ilyen cikkszám: hibaüzenet, nem üres siker", async () => {
    const { db } = database({ variants: [] });
    const resolved = await resolveTargets("sku:nincsilyen", "wh_1", db);

    assert.ok(!Array.isArray(resolved));
    assert.match(resolved.error, /nincs ilyen cikkszámú aktív változat/);
  });

  it("termékazonosítóból a termék MINDEN aktív változata jön", async () => {
    const { db, queries } = database({
      variants: [
        VARIANT,
        { id: "var_2", sku: "teszt0002", productId: "prod-os-1" },
      ],
    });
    const resolved = await resolveTargets("prod-os-1", "wh_1", db);

    assert.ok(Array.isArray(resolved));
    assert.equal(resolved.length, 2);
    const variantQuery = queries.find(
      (entry) => entry.table === "productVariant",
    );
    assert.deepEqual((variantQuery as { where: unknown }).where, {
      productId: "prod-os-1",
      isActive: true,
    });
  });
});

const report = (overrides: Partial<InventoryProjectionReport> = {}) =>
  ({
    sku: "teszt0001",
    onHand: "5",
    reserved: "2",
    availableToSell: "3",
    medusaQuantity: 3,
    medusaReserved: null,
    locationId: "sloc_1",
    locationName: "Acropora",
    inventoryItemId: "iitem_1",
    variantId: "variant_1",
    clamped: false,
    fractionDropped: false,
    backorder: true,
    levelResult: "updated",
    backorderResult: "unchanged",
    ...overrides,
  }) satisfies InventoryProjectionReport;

describe("Készlet-parancs: mit ír ki", () => {
  it("a brief kért sorai mind ott vannak", () => {
    const text = describeInventory(report());
    for (const line of [
      "on hand: 5",
      "reserved: 2",
      "available to sell: 3",
      "medusa quantity: 3",
      "location: Acropora (sloc_1)",
      "result: updated",
    ])
      assert.match(text, new RegExp(line.replace(/[()]/g, "\\$&")));
  });

  /**
   * A rendelhetőség sora azért kötelező, mert az alapértelmezés a döntés
   * ellentéte: enélkül egy elmaradt beállítás ugyanúgy néz ki, mint egy
   * sikeres futás.
   */
  it("a rendelhetőség állapota látszik, és az is, hogy MOST állt-e be", () => {
    assert.match(
      describeInventory(report({ backorderResult: "set" })),
      /backorder: engedélyezve \(most állítottuk be\)/,
    );
    assert.match(
      describeInventory(report({ backorderResult: "unchanged" })),
      /backorder: engedélyezve \(már így állt\)/,
    );
  });

  it("a negatívról vágás külön sorban látszik", () => {
    const text = describeInventory(
      report({ availableToSell: "-2", medusaQuantity: 0, clamped: true }),
    );
    assert.match(text, /negatívról vágva: -2 -> 0/);
  });

  it("a törtrész elhagyása külön sorban látszik", () => {
    const text = describeInventory(
      report({
        availableToSell: "2.7",
        medusaQuantity: 2,
        fractionDropped: true,
      }),
    );
    assert.match(text, /törtrész elhagyva: 2.7 -> 2/);
  });

  it("változatlan futásnál nincs vágás-sor", () => {
    const text = describeInventory(report());
    assert.ok(!text.includes("negatívról vágva"));
    assert.ok(!text.includes("törtrész elhagyva"));
  });

  /**
   * A Medusa SAJÁT foglalása az OS foglalásán FELÜL vonódik le. Ez nem hiba,
   * hanem következmény - de látnia kell annak, aki a számokat összeveti.
   */
  it("a Medusa saját foglalása kiíródik, ha a válasz hozta", () => {
    assert.match(
      describeInventory(report({ medusaReserved: 1 })),
      /medusa reserved: 1/,
    );
    assert.ok(!describeInventory(report()).includes("medusa reserved"));
  });
});
