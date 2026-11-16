import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type ArrivalSourceRow,
  arrivalsDiffer,
  cappedArrivals,
  describeLivestockArrivalsProjection,
  projectLivestockArrivals,
  projectLivestockArrivalsInRound,
  publicArrivals,
} from "./medusa-livestock-arrivals-projection.js";

/*
  THE LIVE ANIMALS ON THEIR WAY TO THE SHOP'S LIST (V2.6 S4b, card f4e4832b). WHAT TURNS THIS RED: a not-preorderable, arrived
  or cancelled arrival published; the quantity or the note going out (the row shape); a bound arrival without its shop product
  id; a write when nothing differs, or none when something does; the round on without its switch.
*/
const row = (over: Partial<ArrivalSourceRow> = {}): ArrivalSourceRow => ({
  id: "arr-1",
  kind: "FISH",
  label: " Amphiprion ocellaris ",
  expectedOn: new Date("2026-11-20T00:00:00Z"),
  status: "ORDERED",
  preorderable: true,
  productId: null,
  ...over,
});

describe("publicArrivals", () => {
  it("only preorderable, open arrivals; the day as a day, the label trimmed, the bound one with its shop id, nothing else", () => {
    const out = publicArrivals(
      [
        row(),
        row({
          id: "arr-2",
          status: "IN_TRANSIT",
          productId: "p1",
          kind: "CORAL",
          label: "Acropora tenuis",
        }),
        row({ id: "arr-3", productId: "p-unlinked" }),
        row({ id: "x-off", preorderable: false }),
        row({ id: "x-arrived", status: "ARRIVED" }),
        row({ id: "x-cancelled", status: "CANCELLED" }),
        row({ id: "x-empty", label: "  " }),
      ],
      new Map([["p1", "prod_medusa_1"]]),
    );
    assert.deepEqual(out, [
      {
        os_id: "arr-1",
        kind: "FISH",
        label: "Amphiprion ocellaris",
        expected_on: "2026-11-20",
        status: "ORDERED",
        medusa_product_id: null,
      },
      {
        os_id: "arr-2",
        kind: "CORAL",
        label: "Acropora tenuis",
        expected_on: "2026-11-20",
        status: "IN_TRANSIT",
        medusa_product_id: "prod_medusa_1",
      },
      {
        os_id: "arr-3",
        kind: "FISH",
        label: "Amphiprion ocellaris",
        expected_on: "2026-11-20",
        status: "ORDERED",
        medusa_product_id: null,
      },
    ]);
    // the shape is the contract: no quantity, no note, no preorderable
    assert.deepEqual(Object.keys(out[0]!).sort(), [
      "expected_on",
      "kind",
      "label",
      "medusa_product_id",
      "os_id",
      "status",
    ]);
  });

  it("arrivalsDiffer compares the sets field by field, whatever the order", () => {
    const a = publicArrivals([row(), row({ id: "arr-2" })], new Map());
    assert.equal(arrivalsDiffer([...a].reverse(), a), false);
    assert.equal(arrivalsDiffer(a, [{ ...a[0]!, label: "Más" }, a[1]!]), true);
    assert.equal(arrivalsDiffer(a, a.slice(1)), true);
  });
});

describe("projectLivestockArrivals", () => {
  const source = (rows: ArrivalSourceRow[]) => ({
    rows: async () => rows,
    medusaIds: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, `med_${id}`])),
  });

  it("writes the whole set only on a difference, and only with apply", async () => {
    const sent: unknown[] = [];
    let shop: ReturnType<typeof publicArrivals> = [];
    const client = {
      fetchLivestockArrivals: async () => shop,
      replaceLivestockArrivals: async (
        arrivals: ReturnType<typeof publicArrivals>,
      ) => {
        sent.push(arrivals);
        shop = arrivals;
      },
    };
    const rows = [row(), row({ id: "arr-2", productId: "p9" })];
    assert.deepEqual(
      await projectLivestockArrivals(client, source(rows), false),
      { status: "would-send", count: 2 },
    );
    assert.equal(sent.length, 0);
    assert.deepEqual(
      await projectLivestockArrivals(client, source(rows), true),
      { status: "sent", count: 2 },
    );
    assert.equal(
      (shop[1] as { medusa_product_id: string }).medusa_product_id,
      "med_p9",
    );
    assert.deepEqual(
      await projectLivestockArrivals(client, source(rows), true),
      { status: "unchanged", count: 2 },
    );
    assert.equal(sent.length, 1);
    // an arrival that left (arrived): the whole set without it
    await projectLivestockArrivals(client, source([row()]), true);
    assert.equal(sent.length, 2);
    assert.deepEqual(
      shop.map((r) => r.os_id),
      ["arr-1"],
    );
  });

  it("over the shop's cap: the earliest days go, the rest is counted and said (barracuda, #2354)", () => {
    const rows = [
      {
        os_id: "c",
        kind: "FISH" as const,
        label: "C",
        expected_on: "2026-11-22",
        status: "ORDERED" as const,
        medusa_product_id: null,
      },
      {
        os_id: "a",
        kind: "FISH" as const,
        label: "A",
        expected_on: "2026-11-20",
        status: "ORDERED" as const,
        medusa_product_id: null,
      },
      {
        os_id: "b",
        kind: "FISH" as const,
        label: "B",
        expected_on: "2026-11-21",
        status: "ORDERED" as const,
        medusa_product_id: null,
      },
    ];
    const capped = cappedArrivals(rows, 2);
    assert.deepEqual(
      capped.rows.map((r) => r.os_id),
      ["a", "b"],
    );
    assert.equal(capped.leftOut, 1);
    assert.deepEqual(cappedArrivals(rows, 3), { rows, leftOut: 0 });
    assert.match(
      describeLivestockArrivalsProjection({
        status: "sent",
        count: 2,
        leftOut: 1,
      }),
      /1 sor kimaradt a 1000-es plafon miatt/,
    );
  });

  it("the round runs only with its switch exactly true", () => {
    assert.equal(projectLivestockArrivalsInRound({}), false);
    assert.equal(
      projectLivestockArrivalsInRound({
        MEDUSA_PROJECT_LIVESTOCK_ARRIVALS: "1",
      }),
      false,
    );
    assert.equal(
      projectLivestockArrivalsInRound({
        MEDUSA_PROJECT_LIVESTOCK_ARRIVALS: "true",
      }),
      true,
    );
  });
});
