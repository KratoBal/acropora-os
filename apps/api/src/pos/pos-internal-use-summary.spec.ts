import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  summarizeInternalUses,
  type PosInternalUseSummaryRow,
} from "./pos-internal-use-summary.js";

/*
  THE INTERNAL-USE SUMMARY OF A PERIOD (card ada14a7c), without a database. WHAT TURNS IT RED: a record counted on its UTC day
  instead of its Budapest day (00:30 on the first of the month belongs to that month, in winter and in summer); an unpriced
  line counted as zero in the known value, or missing from the unpriced list; a record outside the days counted; the newest
  record not first; a record with a missing price showing a value.
*/

const D = (value: number | string) => new Prisma.Decimal(value);
const line = (
  sku: string,
  quantity: number,
  unitCost: number | null,
): PosInternalUseSummaryRow["lines"][number] => ({
  sku,
  productName: `Termék ${sku}`,
  quantity: D(quantity),
  unit: "db",
  unitCost: unitCost === null ? null : D(unitCost),
});
const record = (
  id: string,
  occurredAt: string,
  lines: PosInternalUseSummaryRow["lines"],
): PosInternalUseSummaryRow => ({
  id,
  number: `BFH-${id}`,
  note: `megjegyzés ${id}`,
  performedByName: "Bolt",
  occurredAt: new Date(occurredAt),
  totalCost: lines.every((l) => l.unitCost !== null)
    ? lines.reduce((sum, l) => sum.plus(l.unitCost!.times(l.quantity)), D(0))
    : null,
  lines,
});

describe("summarizeInternalUses", () => {
  it("counts a record on its Budapest day, in winter and in summer", () => {
    const rows = [
      // 2026-11-01 00:30 in Budapest (CET, +1): November
      record("nov-first", "2026-10-31T23:30:00Z", [line("A", 1, 100)]),
      // 2026-10-31 23:30 in Budapest: October, not November
      record("oct-last", "2026-10-31T22:30:00Z", [line("B", 1, 100)]),
      // 2026-07-01 00:30 in Budapest (CEST, +2): July
      record("jul-first", "2026-06-30T22:30:00Z", [line("C", 1, 100)]),
    ];
    assert.deepEqual(
      summarizeInternalUses("2026-11-01", "2026-11-30", rows).records.map(
        (r) => r.id,
      ),
      ["nov-first"],
    );
    assert.deepEqual(
      summarizeInternalUses("2026-10-01", "2026-10-31", rows).records.map(
        (r) => r.id,
      ),
      ["oct-last"],
    );
    assert.deepEqual(
      summarizeInternalUses("2026-07-01", "2026-07-31", rows).records.map(
        (r) => r.id,
      ),
      ["jul-first"],
    );
  });

  it("sums only the priced lines and lists the unpriced ones apart, the newest record first", () => {
    const summary = summarizeInternalUses("2026-11-01", "2026-11-30", [
      record("early", "2026-11-03T10:00:00Z", [
        line("A", 2, 1500.5),
        line("B", 1, null),
      ]),
      record("late", "2026-11-20T10:00:00Z", [line("C", 3, 1000)]),
    ]);
    assert.deepEqual(
      [
        summary.recordCount,
        summary.lineCount,
        summary.knownCost,
        summary.unpricedLineCount,
      ],
      [2, 3, "6001.00", 1],
    );
    assert.deepEqual(
      summary.records.map((r) => [
        r.id,
        r.totalCost,
        r.lineCount,
        r.unpricedLineCount,
      ]),
      [
        ["late", "3000.00", 1, 0],
        ["early", null, 2, 1],
      ],
    );
    assert.deepEqual(summary.unpricedLines, [
      {
        internalUseId: "early",
        number: "BFH-early",
        occurredAt: "2026-11-03T10:00:00.000Z",
        sku: "B",
        productName: "Termék B",
        quantity: "1",
        unit: "db",
      },
    ]);
  });

  it("an empty period is zeros, not an error", () => {
    assert.deepEqual(summarizeInternalUses("2026-11-01", "2026-11-30", []), {
      from: "2026-11-01",
      to: "2026-11-30",
      recordCount: 0,
      lineCount: 0,
      knownCost: "0.00",
      unpricedLineCount: 0,
      records: [],
      unpricedLines: [],
    });
  });
});
