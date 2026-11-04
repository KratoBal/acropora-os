import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  currentReductionStart,
  lowestPriceInWindow,
  seriesOfVariant,
  type HistoryRow,
  type PricePoint,
} from "./lowest-price.js";
import {
  lowestPriceForVariant,
  type LowestPriceDatabase,
} from "./lowest-price.reader.js";

/*
  WHAT TURNS THIS RED (V0.2, slice 1; reference = the 30 days BEFORE the reduction, #2120 review). The
  sale price itself (a point that begins AT the reduction start) becoming the answer; a segment that
  ends exactly at the window start counting (zero length); `complete` true while an unknown stretch
  reaches into the window (a leading, a middle or a trailing gap); two currencies in one window
  giving an answer. The price in force at the START of the window ignored (a price
  that did not move for 40 days must count); a segment that ended before the window counted; a
  window shorter than 30 days reported as complete (the shop would claim 30 days it does not have);
  the lowest taken from rows outside the window; an unknown price counted as zero; the later of two
  rows at the same instant not winning; a variant's surcharge not added to the mirror price; a sale
  price ignored (the shop is sent it as the price); a frozen mirror row after the takeover pulling the
  answer; another variant's own row mixing into this variant.
*/
const D = (v: string | number) => new Prisma.Decimal(v);
const day = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)); // 2026-10-01 + n days
// the reduction begins 2026-11-10 (day 40); the window is [2026-10-11, 2026-11-10) (day 10 to day 40)
const NOW = day(40);

const point = (
  at: Date,
  amount: string | null,
  currency = "HUF",
): PricePoint => ({
  at,
  amount: amount === null ? null : D(amount),
  currency,
});

describe("lowestPriceInWindow", () => {
  it("counts the price in force at the start of the window even though its row is older", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "1000"), point(day(20), "1200")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1000");
    assert.equal(
      result.since.getTime(),
      day(10).getTime(),
      "since is the window start, not the old row",
    );
    assert.equal(result.complete, true);
  });

  it("takes the lowest price that applied inside the window, and says since when", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "1500"), point(day(15), "1100"), point(day(25), "1500")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1100");
    assert.equal(result.since.getTime(), day(15).getTime());
  });

  it("ignores a lower price that ended before the window began", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "900"), point(day(5), "1500")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1500");
  });

  it("a history younger than the window is NOT complete, and names where it begins", () => {
    const result = lowestPriceInWindow(
      [point(day(30), "1400"), point(day(35), "1300")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1300");
    assert.equal(result.complete, false);
    assert.equal(result.historyBegins.getTime(), day(30).getTime());
  });

  it("is null without a point before the reduction start, and without any known price", () => {
    assert.equal(lowestPriceInWindow([], NOW), null);
    assert.equal(lowestPriceInWindow([point(day(50), "1000")], NOW), null);
    assert.equal(lowestPriceInWindow([point(day(0), null)], NOW), null);
  });

  it("an unknown price is a gap, never zero: the lowest known price still wins, but the answer is NOT complete", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "1000"), point(day(20), null), point(day(30), "1300")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1000");
    assert.equal(result.complete, false, "day 20 to 30 is unknown");
  });

  it("a leading unknown stretch that reaches into the window is not complete, though the history 'begins' before it", () => {
    const result = lowestPriceInWindow(
      [point(day(0), null), point(day(20), "1200")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1200");
    assert.equal(result.complete, false, "day 10 to 20 is unknown");
    assert.equal(result.historyBegins.getTime(), day(20).getTime());
  });

  it("a trailing unknown stretch is not complete either", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "1000"), point(day(35), null)],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1000");
    assert.equal(result.complete, false);
  });

  it("an unknown stretch that ended before the window began does not spoil completeness", () => {
    const result = lowestPriceInWindow(
      [point(day(0), null), point(day(5), "1200")],
      NOW,
    )!;
    assert.equal(result.complete, true);
    assert.equal(result.historyBegins.getTime(), day(5).getTime());
  });

  it("the sale price that begins AT the reduction start is not its own reference", () => {
    const reductionStart = day(38);
    const result = lowestPriceInWindow(
      [point(day(0), "1500"), point(day(38), "1000")],
      reductionStart,
    )!;
    assert.equal(result.amount.toString(), "1500");
    assert.equal(result.complete, true);
    assert.equal(result.reductionStart.getTime(), reductionStart.getTime());
    // and with nothing but the sale point there is nothing to name
    assert.equal(
      lowestPriceInWindow([point(day(38), "1000")], reductionStart),
      null,
    );
  });

  it("a price that ended exactly when the window began is not in the window", () => {
    const result = lowestPriceInWindow(
      [point(day(0), "900"), point(day(10), "1500")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1500");
    assert.equal(result.since.getTime(), day(10).getTime());
  });

  it("two currencies in the window have no answer", () => {
    assert.equal(
      lowestPriceInWindow(
        [point(day(0), "1000", "HUF"), point(day(20), "3", "EUR")],
        NOW,
      ),
      null,
    );
    // a currency from before the window does not count
    assert.equal(
      lowestPriceInWindow(
        [point(day(0), "3", "EUR"), point(day(5), "1000", "HUF")],
        NOW,
      )!.amount.toString(),
      "1000",
    );
  });

  it("two rows at the same instant: the later one in the input wins", () => {
    const result = lowestPriceInWindow(
      [point(day(15), "900"), point(day(15), "1200")],
      NOW,
    )!;
    assert.equal(result.amount.toString(), "1200");
  });

  it("an equal lowest price keeps the earliest start", () => {
    const result = lowestPriceInWindow(
      [point(day(12), "1000"), point(day(20), "1200"), point(day(30), "1000")],
      NOW,
    )!;
    assert.equal(result.since.getTime(), day(12).getTime());
  });

  it("works on an unsorted input and does not touch it", () => {
    const input = [
      point(day(25), "1500"),
      point(day(0), "1500"),
      point(day(15), "1100"),
    ];
    const copy = [...input];
    assert.equal(lowestPriceInWindow(input, NOW)!.amount.toString(), "1100");
    assert.deepEqual(input, copy);
  });
});

const row = (over: Partial<HistoryRow> & { observedAt: Date }): HistoryRow => ({
  variantId: null,
  createdAt: over.observedAt,
  currency: "HUF",
  grossPrice: D(1000),
  saleGrossPrice: null,
  ...over,
});

describe("seriesOfVariant", () => {
  it("adds the variant's surcharge to every mirror price, and a sale price replaces the list price", () => {
    const series = seriesOfVariant(
      [
        row({ observedAt: day(0), grossPrice: D(1000) }),
        row({
          observedAt: day(5),
          grossPrice: D(1000),
          saleGrossPrice: D(800),
        }),
      ],
      "v1",
      D(200),
    );
    assert.deepEqual(
      series.map((p) => p.amount?.toString()),
      ["1200", "1000"],
    );
  });

  it("a taken-over variant: the mirror before its first OWN row, then its OWN rows; a mirror row after the takeover is dropped", () => {
    const series = seriesOfVariant(
      [
        row({ observedAt: day(0), grossPrice: D(1000) }),
        row({ observedAt: day(20), grossPrice: D(1100), variantId: "v1" }),
        row({ observedAt: day(25), grossPrice: D(50) }),
        row({ observedAt: day(30), grossPrice: D(1300), variantId: "v1" }),
      ],
      "v1",
      null,
    );
    assert.deepEqual(
      series.map((p) => [p.at.getTime(), p.amount?.toString()]),
      [
        [day(0).getTime(), "1000"],
        [day(20).getTime(), "1100"],
        [day(30).getTime(), "1300"],
      ],
    );
  });

  it("another variant's own rows never enter this variant's series", () => {
    const series = seriesOfVariant(
      [
        row({ observedAt: day(0), grossPrice: D(1000) }),
        row({ observedAt: day(20), grossPrice: D(1), variantId: "other" }),
      ],
      "v1",
      null,
    );
    assert.equal(series.length, 1);
  });

  it("a mirror row with no price at all is an unknown point", () => {
    const series = seriesOfVariant(
      [row({ observedAt: day(0), grossPrice: null, saleGrossPrice: null })],
      "v1",
      D(200),
    );
    assert.equal(series[0]!.amount, null);
  });
});

describe("lowestPriceForVariant", () => {
  it("asks for the product's mirror rows AND the variant's own rows, and computes from them", async () => {
    const calls: { variant?: unknown; history?: unknown } = {};
    const database: LowestPriceDatabase = {
      productVariant: {
        findUnique: async (args) => {
          calls.variant = args;
          return { productId: "p1", unasVariantExtraGrossPrice: D(100) };
        },
      },
      productPriceHistory: {
        findMany: async (args) => {
          calls.history = args;
          return [row({ observedAt: day(0), grossPrice: D(1000) })];
        },
      },
    };
    const result = await lowestPriceForVariant(database, "v1", NOW);
    assert.equal(result?.amount.toString(), "1100");
    const where = (calls.history as { where: unknown }).where;
    assert.deepEqual(where, {
      productId: "p1",
      OR: [{ variantId: null }, { variantId: "v1" }],
    });
  });

  it("is null for an unknown variant, without reading any history", async () => {
    let read = false;
    const database: LowestPriceDatabase = {
      productVariant: { findUnique: async () => null },
      productPriceHistory: {
        findMany: async () => {
          read = true;
          return [];
        },
      },
    };
    assert.equal(await lowestPriceForVariant(database, "nincs", NOW), null);
    assert.equal(read, false);
  });
});

describe("currentReductionStart", () => {
  const sale = (n: number, price: string | null) =>
    row({
      observedAt: day(n),
      saleGrossPrice: price === null ? null : D(price),
    });

  it("is the first day of the sale run that is in force now", () => {
    const rows = [sale(0, null), sale(10, "1200"), sale(20, "900")];
    assert.equal(
      currentReductionStart(rows, "v1")?.getTime(),
      day(10).getTime(),
    );
  });

  it("is null when the last row has no sale price (the reduction ended)", () => {
    assert.equal(
      currentReductionStart(
        [sale(0, null), sale(10, "1200"), sale(20, null)],
        "v1",
      ),
      null,
    );
  });

  it("a second, separate sale is measured from its own first day", () => {
    const rows = [sale(0, "1200"), sale(5, null), sale(30, "1100")];
    assert.equal(
      currentReductionStart(rows, "v1")?.getTime(),
      day(30).getTime(),
    );
  });

  it("is null for a taken-over variant (it has own rows: no sale concept), and without rows", () => {
    assert.equal(
      currentReductionStart(
        [sale(0, "1200"), row({ observedAt: day(5), variantId: "v1" })],
        "v1",
      ),
      null,
    );
    assert.equal(currentReductionStart([], "v1"), null);
  });
});
