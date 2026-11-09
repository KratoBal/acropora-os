import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { LowestPriceDatabase } from "../../products/price-history/lowest-price.reader.js";
import type { HistoryRow } from "../../products/price-history/lowest-price.js";
import {
  OMNIBUS_METADATA_KEY,
  omnibusInputsFor,
  omnibusMetadataValue,
  day as budapestDay,
  omnibusProjectionEnabled,
  planOmnibusWrite,
} from "./medusa-variant-omnibus.js";
import { describeVariantOmnibus } from "./medusa-projection.runner.js";

/*
  WHAT TURNS THIS RED (V0.2, slice 2). The switch turning on for anything but exactly "true"; the
  history being read while the switch is off; a variant WITHOUT a running reduction not getting ""
  (its key would stay and the shop would keep a reference to a reduction that ended); the running
  sale price becoming its own reference (the value must be the price BEFORE the reduction); the
  value changing without the reference changing (a run-time stamp in it would write every variant
  every round); the plan writing an unchanged value or clearing a key that is not there.
*/
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n));

const row = (over: Partial<HistoryRow> & { observedAt: Date }): HistoryRow => ({
  variantId: null,
  createdAt: over.observedAt,
  currency: "HUF",
  grossPrice: D(1500),
  saleGrossPrice: null,
  ...over,
});

function database(rows: HistoryRow[]): {
  database: LowestPriceDatabase;
  reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    database: {
      productVariant: {
        findUnique: async () => {
          reads += 1;
          return {
            productId: "p1",
            unasVariantExtraGrossPrice: null,
            sellingSaleGrossPrice: null,
            sellingSaleStartsAt: null,
            sellingSaleEndsAt: null,
          };
        },
      },
      productPriceHistory: { findMany: async () => rows },
    },
  };
}

describe("omnibusProjectionEnabled", () => {
  it("is on for exactly the text true", () => {
    assert.equal(
      omnibusProjectionEnabled({ MEDUSA_PROJECT_OMNIBUS: "true" }),
      true,
    );
    for (const value of [undefined, "", "false", "True", "1", "on"])
      assert.equal(
        omnibusProjectionEnabled({ MEDUSA_PROJECT_OMNIBUS: value }),
        false,
        String(value),
      );
  });
});

describe("omnibusInputsFor", () => {
  const variants = [{ id: "v1", sku: "A" }];

  it("reads nothing while the switch is off", async () => {
    const fake = database([row({ observedAt: day(0) })]);
    assert.equal(
      await omnibusInputsFor(fake.database, variants, {}),
      undefined,
    );
    assert.equal(fake.reads(), 0);
  });

  it("a running reduction: the value is the price BEFORE it, not the sale price", async () => {
    const fake = database([
      row({ observedAt: day(0), grossPrice: D(1500) }),
      row({
        observedAt: day(38),
        grossPrice: D(1500),
        saleGrossPrice: D(1000),
      }),
    ]);
    const result = await omnibusInputsFor(fake.database, variants, {
      MEDUSA_PROJECT_OMNIBUS: "true",
    });
    assert.equal(result?.length, 1);
    const parsed = JSON.parse(result![0]!.value) as Record<string, unknown>;
    assert.equal(parsed.amount, "1500");
    assert.equal(parsed.reduction_start, "2026-11-08");
    assert.equal(parsed.complete, true);
  });

  it("no running reduction: the value is the empty text, which clears the key", async () => {
    const fake = database([
      row({ observedAt: day(0), grossPrice: D(1500) }),
      row({
        observedAt: day(10),
        grossPrice: D(1500),
        saleGrossPrice: D(1000),
      }),
      row({ observedAt: day(20), grossPrice: D(1500), saleGrossPrice: null }),
    ]);
    const result = await omnibusInputsFor(fake.database, variants, {
      MEDUSA_PROJECT_OMNIBUS: "true",
    });
    assert.deepEqual(result, [{ sku: "A", value: "" }]);
  });

  it("a reduction that began BEFORE a later cut is measured from its FIRST day", async () => {
    const fake = database([
      row({ observedAt: day(0), grossPrice: D(1500) }),
      row({
        observedAt: day(30),
        grossPrice: D(1500),
        saleGrossPrice: D(1200),
      }),
      row({ observedAt: day(35), grossPrice: D(1500), saleGrossPrice: D(900) }),
    ]);
    const result = await omnibusInputsFor(fake.database, variants, {
      MEDUSA_PROJECT_OMNIBUS: "true",
    });
    const parsed = JSON.parse(result![0]!.value) as Record<string, unknown>;
    assert.equal(parsed.amount, "1500");
    assert.equal(parsed.reduction_start, "2026-10-31");
  });
});

describe("omnibusMetadataValue and planOmnibusWrite", () => {
  it("a null reference is the empty text", () => {
    assert.equal(omnibusMetadataValue(null), "");
  });

  it("writes only what changed, clears only what is there", () => {
    const value = JSON.stringify({ amount: "1" });
    assert.equal(
      planOmnibusWrite({ [OMNIBUS_METADATA_KEY]: value }, value),
      "unchanged",
    );
    assert.equal(
      planOmnibusWrite({ [OMNIBUS_METADATA_KEY]: "x" }, value),
      "write",
    );
    assert.equal(planOmnibusWrite(null, value), "write");
    assert.equal(planOmnibusWrite({ mas: "y" }, ""), "unchanged");
    assert.equal(
      planOmnibusWrite({ [OMNIBUS_METADATA_KEY]: value }, ""),
      "write",
    );
  });
});

describe("a gap in the window gets no value", () => {
  it("an unknown-price stretch before the reduction: the value is empty, the input is marked, the key is cleared", async () => {
    const fake = database([
      row({ observedAt: day(0), grossPrice: D(1500) }),
      row({ observedAt: day(20), grossPrice: null }),
      row({ observedAt: day(30), grossPrice: D(1400) }),
      row({
        observedAt: day(38),
        grossPrice: D(1400),
        saleGrossPrice: D(1000),
      }),
    ]);
    const result = await omnibusInputsFor(
      fake.database,
      [{ id: "v1", sku: "A" }],
      { MEDUSA_PROJECT_OMNIBUS: "true" },
    );
    assert.deepEqual(result, [{ sku: "A", value: "", gap: true }]);
  });

  it("a young history without a gap IS written, as incomplete, naming the first price day", async () => {
    const fake = database([
      row({ observedAt: day(30), grossPrice: D(1500) }),
      row({
        observedAt: day(38),
        grossPrice: D(1500),
        saleGrossPrice: D(1000),
      }),
    ]);
    const result = await omnibusInputsFor(
      fake.database,
      [{ id: "v1", sku: "A" }],
      { MEDUSA_PROJECT_OMNIBUS: "true" },
    );
    const parsed = JSON.parse(result![0]!.value) as Record<string, unknown>;
    assert.equal(parsed.complete, false);
    assert.equal(parsed.history_begins, "2026-10-31");
    assert.equal(result![0]!.gap, undefined);
  });

  it("the report names the gap variants", () => {
    const text = describeVariantOmnibus({
      written: [],
      cleared: [],
      unchanged: 0,
      missing: [],
      failed: [],
      gaps: ["A-1", "B-2"],
    });
    assert.match(text, /rés az ablakban/);
    assert.match(text, /A-1, B-2/);
    assert.equal(
      describeVariantOmnibus({
        written: [],
        cleared: [],
        unchanged: 3,
        missing: [],
        failed: [],
        gaps: [],
      }),
      "",
    );
  });
});

describe("the day in the metadata is the Budapest day", () => {
  it("23:30 UTC (summer) is already the next day in Budapest", () => {
    assert.equal(budapestDay(new Date("2026-10-24T22:30:00Z")), "2026-10-25");
    assert.equal(budapestDay(new Date("2026-10-24T21:30:00Z")), "2026-10-24");
  });

  it("in winter the day changes at 23:00 UTC", () => {
    assert.equal(budapestDay(new Date("2026-11-10T22:59:00Z")), "2026-11-10");
    assert.equal(budapestDay(new Date("2026-11-10T23:00:00Z")), "2026-11-11");
  });
});
