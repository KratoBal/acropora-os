import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  formatOrderFormDate,
  formatOrderFormSummaryAmount,
  formatOrderFormTableAmount,
} from "./maintenance-order-form-formatting.js";

describe("maintenance order form formatting", () => {
  it("formats a table amount with space-grouped thousands, no fillér", () => {
    // A minta-lap táblázat-cellája: "410 000 Ft".
    assert.equal(
      formatOrderFormTableAmount(new Prisma.Decimal(410000)),
      "410 000 Ft",
    );
    assert.equal(
      formatOrderFormTableAmount(new Prisma.Decimal(1900000)),
      "1 900 000 Ft",
    );
  });

  it("formats a summary amount with dot-grouped thousands and the ',- Ft' suffix", () => {
    // A minta-lap összesítő sora: "7.302.500,- Ft".
    assert.equal(
      formatOrderFormSummaryAmount(new Prisma.Decimal(7302500)),
      "7.302.500,- Ft",
    );
    assert.equal(
      formatOrderFormSummaryAmount(new Prisma.Decimal(5750000)),
      "5.750.000,- Ft",
    );
    assert.equal(
      formatOrderFormSummaryAmount(new Prisma.Decimal(1552500)),
      "1.552.500,- Ft",
    );
  });

  it("rounds a fractional forint value before formatting either way", () => {
    assert.equal(
      formatOrderFormTableAmount(new Prisma.Decimal("410000.5")),
      "410 001 Ft",
    );
    assert.equal(
      formatOrderFormSummaryAmount(new Prisma.Decimal("410000.4")),
      "410.000,- Ft",
    );
  });

  it("keeps a plain ISO date as-is, and normalizes a timestamp to the date", () => {
    assert.equal(formatOrderFormDate("2026-09-24"), "2026-09-24");
    assert.equal(formatOrderFormDate("2026-09-24T10:00:00.000Z"), "2026-09-24");
  });
});
