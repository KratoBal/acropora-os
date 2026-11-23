import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import type {
  CreatePosInternalUseParams,
  PosInternalUseRepository,
} from "./pos-internal-use.repository.js";
import { PosInternalUseService } from "./pos-internal-use.service.js";
import type {
  PosSaleRepository,
  PosSaleVariantInfo,
} from "./pos-sale.repository.js";

/*
  THE RULES OF THE POS "BELSŐ FELHASZNÁLÁS" SERVICE (card ec51e614), without a database. WHAT TURNS IT RED: a blank note
  accepted; the same product twice written as two lines; an unknown product, a local (non-UNAS) product or an unresolvable
  package product accepted; a package product's purchase value not taken from its components; a missing component price
  turned into zero instead of "unknown"; the record number minted without the BFH prefix.
*/

const D = (value: number | string) => new Prisma.Decimal(value);
const variant = (
  id: string,
  over: Partial<PosSaleVariantInfo> = {},
): PosSaleVariantInfo => ({
  variantId: id,
  sku: `SKU-${id}`,
  productName: `Termék ${id}`,
  unit: "db",
  vatRate: D(27),
  syncToUnas: true,
  stockComponents: [
    {
      variantId: id,
      sku: `SKU-${id}`,
      productName: `Termék ${id}`,
      unit: "db",
      quantityPerSale: D(1),
      syncToUnas: true,
    },
  ],
  ...over,
});

function fake(
  variants: PosSaleVariantInfo[],
  costs: Record<string, number | null>,
) {
  const created: CreatePosInternalUseParams[] = [];
  const summaryReads: [string, string][] = [];
  const sales = {
    currentStock: async () => ({
      warehouseId: "wh-1",
      variants: new Map(variants.map((v) => [v.variantId, v])),
    }),
  } as unknown as PosSaleRepository;
  const internalUses = {
    unitCosts: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, costs[id] == null ? null : D(costs[id]!)])),
    create: async (params: CreatePosInternalUseParams) => {
      created.push(params);
      return { detail: { number: params.number } as never, stockWarnings: [] };
    },
    summaryRows: async (from: string, to: string) => {
      summaryReads.push([from, to]);
      return [];
    },
  } as unknown as PosInternalUseRepository;
  return {
    service: new PosInternalUseService(sales, internalUses),
    created,
    summaryReads,
  };
}

describe("a belső felhasználás szabályai", () => {
  it("a megjegyzés kötelező, a szóközök nem számítanak; levágva kerül a rekordba", async () => {
    const { service, created } = fake([variant("a")], { a: 100 });
    await assert.rejects(
      service.create(
        { note: " \n\t ", lines: [{ variantId: "a", quantity: 1 }] },
        "u",
      ),
      BadRequestException,
    );
    assert.equal(created.length, 0);
    await service.create(
      { note: "  teszt  ", lines: [{ variantId: "a", quantity: 1 }] },
      "u",
    );
    assert.equal(created[0]!.note, "teszt");
    assert.match(created[0]!.number, /^BFH-/);
  });

  it("ugyanaz a termék kétszer egy sor, összeadott mennyiséggel", async () => {
    const { service, created } = fake([variant("a")], { a: 100 });
    await service.create(
      {
        note: "x",
        lines: [
          { variantId: "a", quantity: 1 },
          { variantId: "a", quantity: 2 },
        ],
      },
      "u",
    );
    assert.deepEqual(
      created[0]!.lines.map((l) => [
        l.variantId,
        l.quantity.toString(),
        l.unitCost?.toString(),
      ]),
      [["a", "3", "100"]],
    );
    assert.equal(created[0]!.totalCost?.toString(), "300");
  });

  it("ismeretlen, helyi vagy fel nem oldható csomagtermék nem mehet", async () => {
    const { service, created } = fake(
      [
        variant("local", { syncToUnas: false }),
        variant("pkg", { stockComponents: [] }),
      ],
      {},
    );
    for (const variantId of ["nincs", "local", "pkg"])
      await assert.rejects(
        service.create({ note: "x", lines: [{ variantId, quantity: 1 }] }, "u"),
        BadRequestException,
        variantId,
      );
    assert.equal(created.length, 0);
  });

  it("csomagterméknél az érték az összetevőkből jön; egy hiányzó összetevő-ár ismeretlenné teszi, nem nullává", async () => {
    const bundle = variant("pkg", {
      stockComponents: [
        { ...variant("c1").stockComponents[0]!, quantityPerSale: D(2) },
        { ...variant("c2").stockComponents[0]!, quantityPerSale: D(1) },
      ],
    });
    const priced = fake([bundle], { c1: 100, c2: 50 });
    await priced.service.create(
      { note: "x", lines: [{ variantId: "pkg", quantity: 2 }] },
      "u",
    );
    assert.deepEqual(
      [
        priced.created[0]!.lines[0]!.unitCost?.toString(),
        priced.created[0]!.totalCost?.toString(),
      ],
      ["250", "500"],
    );
    const missing = fake([bundle], { c1: 100, c2: null });
    await missing.service.create(
      { note: "x", lines: [{ variantId: "pkg", quantity: 2 }] },
      "u",
    );
    assert.deepEqual(
      [missing.created[0]!.lines[0]!.unitCost, missing.created[0]!.totalCost],
      [null, null],
    );
  });
});

// card ada14a7c: the period summary checks its days the way the sales summary does, before it reads anything
describe("a belső felhasználás időszakos összesítője", () => {
  const NOW = new Date("2026-11-20T23:30:00Z"); // 2026-11-21 00:30 in Budapest

  it("reads the asked Budapest days, and today by default", async () => {
    const { service, summaryReads } = fake([], {});
    await service.summary({ from: "2026-11-01", to: "2026-11-30" }, NOW);
    await service.summary({}, NOW);
    assert.deepEqual(summaryReads, [
      ["2026-11-01", "2026-11-30"],
      ["2026-11-21", "2026-11-21"],
    ]);
  });

  it("refuses a reversed, an impossible or a too long range, and reads nothing", async () => {
    const { service, summaryReads } = fake([], {});
    for (const query of [
      { from: "2026-11-30", to: "2026-11-01" },
      { from: "2026-02-31", to: "2026-03-01" },
      { from: "2026-01-01", to: "2026-12-31" },
    ]) {
      await assert.rejects(
        service.summary(query, NOW),
        BadRequestException,
        JSON.stringify(query),
      );
    }
    assert.deepEqual(summaryReads, []);
  });
});
