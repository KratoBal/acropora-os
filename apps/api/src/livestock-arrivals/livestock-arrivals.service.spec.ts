import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { LivestockArrival } from "@acropora/types";

import type {
  LivestockArrivalFilters,
  LivestockArrivalWrite,
} from "./livestock-arrivals.repository.js";
import {
  LivestockArrivalsService,
  budapestDay,
  isRealDay,
} from "./livestock-arrivals.service.js";

/*
  WHAT TURNS THIS RED (the live animal arrivals' rules, card f4e4832b S2). A day that has the right shape and is not a day
  (`2026-02-30`) stored; a pre-registration on an arrival that is already here or cancelled; a closing status that leaves the
  old pre-registration tick on; a tick set explicitly on a closed arrival accepted; a product that does not exist linked;
  an unrelated edit asked to look the stored product up again; an explicit null not clearing a link, a quantity or a note;
  a blank label saved; "upcoming" counted from UTC instead of the shop's Budapest day.
*/
const stored = (over: Partial<LivestockArrival> = {}): LivestockArrival => ({
  id: "a1",
  kind: "FISH",
  label: "Amphiprion ocellaris",
  productId: null,
  productName: null,
  expectedOn: "2026-11-13",
  quantity: 12,
  status: "ORDERED",
  preorderable: true,
  note: null,
  createdAt: "2026-11-06T08:00:00.000Z",
  updatedAt: "2026-11-06T08:00:00.000Z",
  ...over,
});

function setup(
  initial: LivestockArrival | null = stored(),
  products: readonly string[] = ["p1"],
) {
  const calls = {
    list: [] as LivestockArrivalFilters[],
    created: [] as { data: LivestockArrivalWrite; by: string | null }[],
    updated: [] as LivestockArrivalWrite[],
    productChecks: [] as string[],
  };
  const repository = {
    list: async (filters: LivestockArrivalFilters) => {
      calls.list.push(filters);
      return [stored()];
    },
    get: async () => initial,
    productExists: async (id: string) => {
      calls.productChecks.push(id);
      return products.includes(id);
    },
    create: async (data: LivestockArrivalWrite, by: string | null) => {
      calls.created.push({ data, by });
      return stored({ ...data, id: "new" });
    },
    update: async (_id: string, data: LivestockArrivalWrite) => {
      calls.updated.push(data);
      return stored({ ...data });
    },
  };
  const service = new LivestockArrivalsService(repository as never);
  service.now = () => new Date("2026-11-05T23:30:00Z");
  return { service, calls };
}

const input = {
  kind: "FISH" as const,
  label: "  Paracanthurus hepatus ",
  expectedOn: "2026-11-20",
};

describe("create", () => {
  it("keeps what it is given, trims the label, and defaults to ordered, not pre-registrable, no money", async () => {
    const { service, calls } = setup();
    await service.create(input, "u1");
    assert.deepEqual(calls.created[0], {
      data: {
        kind: "FISH",
        label: "Paracanthurus hepatus",
        productId: null,
        expectedOn: "2026-11-20",
        quantity: null,
        status: "ORDERED",
        preorderable: false,
        note: null,
      },
      by: "u1",
    });
  });

  it("refuses a day that has the right shape and is not a day, and a blank label", async () => {
    const { service, calls } = setup();
    await assert.rejects(
      service.create({ ...input, expectedOn: "2026-02-30" }, null),
      BadRequestException,
    );
    await assert.rejects(
      service.create({ ...input, label: "   " }, null),
      BadRequestException,
    );
    assert.equal(calls.created.length, 0);
  });

  it("allows a pre-registration only while the animal is still coming", async () => {
    const { service, calls } = setup();
    for (const status of ["ORDERED", "IN_TRANSIT"] as const)
      await service.create({ ...input, status, preorderable: true }, null);
    assert.equal(calls.created.length, 2);
    for (const status of ["ARRIVED", "CANCELLED"] as const)
      await assert.rejects(
        service.create({ ...input, status, preorderable: true }, null),
        BadRequestException,
      );
    assert.equal(calls.created.length, 2);
  });

  it("asks whether a linked product exists, and refuses one that does not", async () => {
    const { service, calls } = setup();
    await service.create({ ...input, productId: "p1" }, null);
    assert.deepEqual(calls.productChecks, ["p1"]);
    await assert.rejects(
      service.create({ ...input, productId: "ghost" }, null),
      BadRequestException,
    );
    assert.equal(calls.created.length, 1);
  });

  it("blank note becomes null, a note is trimmed", async () => {
    const { service, calls } = setup();
    await service.create({ ...input, note: "   " }, null);
    await service.create({ ...input, note: "  a futár hívja  " }, null);
    assert.equal(calls.created[0]!.data.note, null);
    assert.equal(calls.created[1]!.data.note, "a futár hívja");
  });
});

describe("update", () => {
  it("changes only what the request names, and keeps the rest", async () => {
    const { service, calls } = setup(stored({ productId: "p1", note: "régi" }));
    await service.update("a1", { quantity: 20 });
    assert.deepEqual(calls.updated[0], {
      kind: "FISH",
      label: "Amphiprion ocellaris",
      productId: "p1",
      expectedOn: "2026-11-13",
      quantity: 20,
      status: "ORDERED",
      preorderable: true,
      note: "régi",
    });
  });

  it("an explicit null clears the link, the quantity and the note; an absent key leaves them", async () => {
    const { service, calls } = setup(
      stored({ productId: "p1", note: "régi", quantity: 5 }),
    );
    await service.update("a1", { productId: null, quantity: null, note: null });
    assert.equal(calls.updated[0]!.productId, null);
    assert.equal(calls.updated[0]!.quantity, null);
    assert.equal(calls.updated[0]!.note, null);
  });

  it("does not ask again about the stored product when it is unchanged, but does for a new one", async () => {
    const { service, calls } = setup(stored({ productId: "removed-since" }), [
      "p2",
    ]);
    await service.update("a1", { label: "Új név" });
    assert.deepEqual(calls.productChecks, []);
    await assert.rejects(
      service.update("a1", { productId: "ghost" }),
      BadRequestException,
    );
    await service.update("a1", { productId: "p2" });
    assert.deepEqual(calls.productChecks, ["ghost", "p2"]);
  });

  it("closing the arrival (arrived, cancelled) takes the pre-registration tick off by itself", async () => {
    for (const status of ["ARRIVED", "CANCELLED"] as const) {
      const { service, calls } = setup(stored({ preorderable: true }));
      await service.update("a1", { status });
      assert.equal(calls.updated[0]!.preorderable, false, status);
    }
  });

  it("a tick set EXPLICITLY on a closed arrival is refused", async () => {
    const { service } = setup(
      stored({ preorderable: false, status: "ARRIVED" }),
    );
    await assert.rejects(
      service.update("a1", { preorderable: true }),
      BadRequestException,
    );
    await assert.rejects(
      service.update("a1", { status: "CANCELLED", preorderable: true }),
      BadRequestException,
    );
  });

  it("an arrival that is already closed keeps being editable (a note, a quantity) without a tick", async () => {
    const { service, calls } = setup(
      stored({ preorderable: false, status: "ARRIVED" }),
    );
    await service.update("a1", { note: "megjött, 11 darab" });
    assert.equal(calls.updated[0]!.preorderable, false);
    assert.equal(calls.updated[0]!.status, "ARRIVED");
  });

  it("refuses a day that is not one, and answers 404 for an unknown arrival", async () => {
    await assert.rejects(
      setup().service.update("a1", { expectedOn: "2026-13-01" }),
      BadRequestException,
    );
    await assert.rejects(
      setup(null).service.update("x", { quantity: 1 }),
      NotFoundException,
    );
    await assert.rejects(setup(null).service.get("x"), NotFoundException);
  });
});

describe("list", () => {
  it("passes the filters, and counts 'upcoming' from the shop's Budapest day, not from UTC", async () => {
    const { service, calls } = setup();
    await service.list({
      status: "ORDERED",
      kind: "CORAL",
      preorderable: true,
      upcoming: true,
    });
    // 2026-11-05 23:30 UTC is already 2026-11-06 in Budapest (CET)
    assert.deepEqual(calls.list[0], {
      status: "ORDERED",
      kind: "CORAL",
      preorderable: true,
      upcoming: { today: "2026-11-06" },
    });
    await service.list({});
    assert.equal(calls.list[1]!.upcoming, undefined);
  });

  it("the Budapest day is right across the summer-time shift and the midnight edge", () => {
    assert.equal(budapestDay(new Date("2026-11-05T22:59:59Z")), "2026-11-05");
    assert.equal(budapestDay(new Date("2026-11-05T23:00:00Z")), "2026-11-06");
    assert.equal(budapestDay(new Date("2026-07-01T21:59:59Z")), "2026-07-01");
    assert.equal(budapestDay(new Date("2026-07-01T22:00:00Z")), "2026-07-02");
  });
});

describe("isRealDay", () => {
  it("accepts real days and refuses the rest", () => {
    for (const ok of ["2026-11-06", "2028-02-29"])
      assert.equal(isRealDay(ok), true, ok);
    for (const bad of [
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "2026-00-10",
      "2026-1-5",
      "",
      "2026-11-06T00:00",
      "abc",
    ])
      assert.equal(isRealDay(bad), false, bad);
  });
});
