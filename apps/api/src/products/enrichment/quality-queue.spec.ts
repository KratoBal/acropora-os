import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PRODUCT_FIELD_STATUSES,
  PRODUCT_QUALITY_QUEUE_FILTERS,
} from "@acropora/types";

import { queueFilterWhere, queueSummary, rowMatches } from "./quality-queue.js";

/** Evaluates the database condition the way Postgres would, on one row. */
function whereMatches(
  where: ReturnType<typeof queueFilterWhere>,
  row: { status: string; tier: string },
): boolean {
  const one = (c: { status?: string; tier?: string | { in: string[] } }) =>
    (c.status === undefined || c.status === row.status) &&
    (c.tier === undefined ||
      (typeof c.tier === "string"
        ? c.tier === row.tier
        : c.tier.in.includes(row.tier)));
  if (where.OR) return where.OR.some(one);
  return one(where);
}

describe("a katalógus-sor szűrői a szerveren", () => {
  it("a lekérdezés és a számlálás ugyanazt a sort választja, minden szűrőre és állapotra", () => {
    for (const filter of PRODUCT_QUALITY_QUEUE_FILTERS)
      for (const status of PRODUCT_FIELD_STATUSES)
        for (const tier of ["A", "B", "C"] as const)
          assert.equal(
            whereMatches(queueFilterWhere(filter), { status, tier }),
            rowMatches(filter, { status, tier }),
            `${filter} / ${status} / ${tier}`,
          );
  });

  it("kritikus: a valószínűleg hibás érték és a C-szintű ütközés", () => {
    assert.equal(
      rowMatches("critical", { status: "POSSIBLE_WRONG_VALUE", tier: "A" }),
      true,
    );
    assert.equal(
      rowMatches("critical", { status: "CONFLICTING_SOURCES", tier: "C" }),
      true,
    );
    assert.equal(
      rowMatches("critical", { status: "CONFLICTING_SOURCES", tier: "B" }),
      false,
    );
  });

  it("az összesítő a csoportokból számol", () => {
    assert.deepEqual(
      queueSummary([
        { status: "MISSING", tier: "C", count: 5 },
        { status: "SUGGESTED", tier: "B", count: 2 },
      ]),
      {
        all: 7,
        critical: 0,
        conflict: 0,
        missing: 5,
        suggestion: 2,
        verified: 0,
      },
    );
  });
});
