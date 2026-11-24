import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { LowestPriceDatabase } from "../../products/price-history/lowest-price.reader.js";
import type { HistoryRow } from "../../products/price-history/lowest-price.js";
import {
  OMNIBUS_METADATA_KEY,
  OMNIBUS_MIN_HISTORY_DAYS_DEFAULT,
  omnibusInputsFor,
  omnibusMetadataValue,
  day as budapestDay,
  omnibusProjectionEnabled,
  planOmnibusWrite,
  readOmnibusMinHistoryDays,
} from "./medusa-variant-omnibus.js";
import type { LowestPrice } from "../../products/price-history/lowest-price.js";
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

  it("a young history (at least 15 days) without a gap IS written, as incomplete, naming the first price day", async () => {
    const fake = database([
      row({ observedAt: day(22), grossPrice: D(1500) }),
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
    assert.equal(parsed.history_begins, "2026-10-23");
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

/*
  THE LEAST HISTORY A REDUCTION NEEDS (card 90c54873, Balázs 2026-11-24: "mehet a 15", the number a setting). WHAT TURNS THIS RED: a
  young history shorter than the threshold still getting a key (the shop would announce a reduction on 9 days of history, where the
  decree wants 15 for a product on the market for less than 30 days); the boundary day wrong either way (exactly 15 days is enough,
  14 is not); a complete history refused, or a gap giving a value; the threshold ignored by `omnibusInputsFor`; an unreadable setting
  lowering the bar below 15 or making the run fail instead of using the default and saying so.
*/
describe("the least history a reduction needs", () => {
  const lowest = (over: Partial<LowestPrice> = {}): LowestPrice => ({
    amount: D(1500),
    currency: "HUF",
    since: new Date("2026-11-01T00:00:00Z"),
    windowStart: new Date("2026-10-25T00:00:00Z"),
    reductionStart: new Date("2026-11-23T12:00:00Z"),
    complete: false,
    unknownInWindow: false,
    historyBegins: new Date("2026-11-14T12:00:00Z"),
    ...over,
  });
  /** a young history that began `days` days before the reduction (both at noon, so the Budapest day is the UTC day) */
  const young = (days: number) =>
    lowest({
      historyBegins: new Date(Date.UTC(2026, 10, 23, 12) - days * 86_400_000),
    });

  it("a history of 9 days (the LPS Food case measured on 2026-11-23) gets no key at the default threshold", () => {
    assert.equal(OMNIBUS_MIN_HISTORY_DAYS_DEFAULT, 15);
    assert.equal(omnibusMetadataValue(young(9)), "");
  });

  it("exactly 15 days is enough, 14 is not", () => {
    assert.equal(omnibusMetadataValue(young(14)), "");
    const text = omnibusMetadataValue(young(15));
    assert.notEqual(text, "");
    assert.equal(
      (JSON.parse(text) as Record<string, unknown>).history_begins,
      "2026-11-08",
    );
  });

  it("the threshold is a number the caller passes: 20 needs 20 days, 30 needs 30", () => {
    assert.equal(omnibusMetadataValue(young(19), 20), "");
    assert.notEqual(omnibusMetadataValue(young(20), 20), "");
    assert.equal(omnibusMetadataValue(young(29), 30), "");
    assert.notEqual(omnibusMetadataValue(young(30), 30), "");
  });

  it("a complete history always passes, whatever the threshold; a gap never does", () => {
    assert.notEqual(
      omnibusMetadataValue(
        lowest({
          complete: true,
          historyBegins: new Date("2026-09-01T00:00:00Z"),
        }),
        30,
      ),
      "",
    );
    assert.equal(
      omnibusMetadataValue(lowest({ ...young(25), unknownInWindow: true }), 15),
      "",
    );
  });

  it("omnibusInputsFor hands the threshold on: the same 16-day history is written at 15 and not at 20", async () => {
    const fake = database([
      row({ observedAt: day(22), grossPrice: D(1500) }),
      row({
        observedAt: day(38),
        grossPrice: D(1500),
        saleGrossPrice: D(1000),
      }),
    ]);
    const env = { MEDUSA_PROJECT_OMNIBUS: "true" };
    const at15 = await omnibusInputsFor(
      fake.database,
      [{ id: "v1", sku: "A" }],
      env,
      undefined,
      15,
    );
    const at20 = await omnibusInputsFor(
      fake.database,
      [{ id: "v1", sku: "A" }],
      env,
      undefined,
      20,
    );
    assert.notEqual(at15![0]!.value, "");
    assert.deepEqual(at20, [{ sku: "A", value: "" }]);
  });
});

describe("readOmnibusMinHistoryDays", () => {
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(message);
  const reading = async (value: string | number | null) => {
    warnings.length = 0;
    const days = await readOmnibusMinHistoryDays(async (key) => {
      assert.equal(key, "omnibus_min_history_days");
      return { value };
    }, warn);
    return { days, warned: warnings.length };
  };

  it("reads a stored text, a default number and the bounds, without a warning", async () => {
    for (const [value, days] of [
      ["20", 20],
      [15, 15],
      ["15", 15],
      [30, 30],
      ["30", 30],
    ] as const)
      assert.deepEqual(await reading(value), { days, warned: 0 });
  });

  it("anything that is not a whole number from 15 to 30 reads as 15 and says so", async () => {
    for (const value of [14, "14", 31, "31", 20.5, "tizenöt", "", null, 0, -20])
      assert.deepEqual(await reading(value), { days: 15, warned: 1 });
  });

  it("an unreadable setting (the shop is down, or does not know the key) reads as 15 and says why", async () => {
    warnings.length = 0;
    const days = await readOmnibusMinHistoryDays(async () => {
      throw new Error("HTTP 404");
    }, warn);
    assert.equal(days, 15);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /HTTP 404/);
  });
});
