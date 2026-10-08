import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  computeHandoffPlan,
  type HandoffPlanBomItem,
  type HandoffPlanInput,
  type HandoffPlanStockRow,
} from "./quote-handoff-plan.js";

const D = (n: number) => new Prisma.Decimal(n);

const product = (id: string, quantity: number, variantId = "v1") =>
  ({
    id,
    kind: "PRODUCT",
    variantId,
    name: `termék ${id}`,
    quantity: D(quantity),
    unit: "db",
  }) satisfies HandoffPlanBomItem;

const row = (
  stockItemId: string,
  warehouseId: string,
  onHand: number,
  reserved = 0,
  variantId = "v1",
) =>
  ({
    stockItemId,
    variantId,
    warehouseId,
    warehouseCode: warehouseId.toUpperCase(),
    warehouseName: `raktár ${warehouseId}`,
    onHand: D(onHand),
    reserved: D(reserved),
  }) satisfies HandoffPlanStockRow;

const plan = (over: Partial<HandoffPlanInput>) =>
  computeHandoffPlan({
    quoteId: "q",
    versionId: "v",
    acceptanceId: "a",
    projectName: "Projekt",
    bomItems: [],
    stockRows: [],
    defaultWarehouse: new Map(),
    excludedWarehouseIds: [],
    ...over,
  });

const holds = (p: ReturnType<typeof plan>) =>
  p.reservations.map((r) => [r.quoteBomItemId, r.stockItemId, r.quantity]);

describe("the handoff plan (#1582 P6)", () => {
  it("needed 5, free 3: a hold of 3 and a shortage of 2", () => {
    const p = plan({
      bomItems: [product("b1", 5)],
      stockRows: [row("s1", "a", 3)],
    });
    assert.deepEqual(
      [holds(p), p.lines[0]!.fromStock, p.lines[0]!.shortage],
      [[["b1", "s1", "3"]], "3", "2"],
      "PLAN-5-3",
    );
  });

  it("two warehouses of 2: 2 + 2 with the default one first, and a shortage of 1", () => {
    const p = plan({
      bomItems: [product("b1", 5)],
      // the default is B, whose code sorts after A
      stockRows: [row("s-a", "a", 2), row("s-b", "b", 2)],
      defaultWarehouse: new Map([["v1", "b"]]),
    });
    assert.deepEqual(
      [holds(p), p.lines[0]!.shortage],
      [
        [
          ["b1", "s-b", "2"],
          ["b1", "s-a", "2"],
        ],
        "1",
      ],
      "PLAN-2-2-1",
    );
  });

  it("a negative free stock counts as none", () => {
    const p = plan({
      bomItems: [product("b1", 2)],
      stockRows: [row("s-a", "a", 1, 4), row("s-b", "b", 5, 4)],
    });
    assert.deepEqual(
      [holds(p), p.lines[0]!.shortage],
      [[["b1", "s-b", "1"]], "1"],
      "PLAN-NEGATIVE-FREE",
    );
  });

  it("two lines of the same product share its free stock", () => {
    const p = plan({
      bomItems: [product("b1", 2), product("b2", 2)],
      stockRows: [row("s1", "a", 3)],
    });
    assert.deepEqual(
      [holds(p), p.lines.map((l) => l.shortage)],
      [
        [
          ["b1", "s1", "2"],
          ["b2", "s1", "1"],
        ],
        ["0", "1"],
      ],
      "PLAN-SHARED-STOCK",
    );
  });

  it("an excluded warehouse gives nothing, and is listed as excluded", () => {
    const p = plan({
      bomItems: [product("b1", 2)],
      stockRows: [row("s-a", "a", 5), row("s-b", "b", 5)],
      excludedWarehouseIds: ["a"],
    });
    assert.deepEqual(
      [holds(p), p.warehouses.map((w) => [w.id, w.excluded])],
      [
        [["b1", "s-b", "2"]],
        [
          ["a", true],
          ["b", false],
        ],
      ],
      "PLAN-EXCLUDED",
    );
  });

  it("a custom line is a shortage in full, a service line is only listed", () => {
    const p = plan({
      bomItems: [
        { ...product("b1", 3), kind: "CUSTOM", variantId: null },
        { ...product("b2", 4), kind: "SERVICE", variantId: null },
      ],
    });
    assert.deepEqual(
      [p.reservations.length, p.lines.map((l) => [l.kind, l.shortage])],
      [
        0,
        [
          ["CUSTOM", "3"],
          ["SERVICE", "0"],
        ],
      ],
      "PLAN-CUSTOM-SERVICE",
    );
  });

  it("the hash is the same for the same rows and moves with the stock", () => {
    const input = {
      bomItems: [product("b1", 5)],
      stockRows: [row("s1", "a", 3)],
    };
    const renamed = {
      ...input,
      stockRows: [{ ...row("s1", "a", 3), warehouseName: "átnevezve" }],
    };
    const moved = { ...input, stockRows: [row("s1", "a", 2)] };
    assert.deepEqual(
      [
        plan(input).planHash === plan(input).planHash,
        plan(input).planHash === plan(renamed).planHash,
        plan(input).planHash === plan(moved).planHash,
      ],
      [true, true, false],
      "PLAN-HASH",
    );
  });
});
