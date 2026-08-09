import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatDateTime,
  formatMoney,
  orderStatusPresentation,
} from "./presentation";

describe("orderStatusPresentation", () => {
  it("gives a physical UNAS deletion precedence over every status", () => {
    assert.deepEqual(
      orderStatusPresentation({
        status: "COMPLETED",
        unasStatusLabel: "Megrendelés lezárva",
        unasDeletedAt: "2026-08-09T10:00:00.000Z",
      }),
      { label: "Törölve a UNAS-ban", tone: "danger" },
    );
  });

  it("uses the UNAS label when one is available", () => {
    assert.deepEqual(
      orderStatusPresentation({
        status: "PICKING",
        unasStatusLabel: "Összekészítés",
        unasDeletedAt: null,
      }),
      { label: "Összekészítés", tone: "neutral" },
    );
  });
});

describe("order formatting", () => {
  it("formats valid currency values and safely falls back for invalid input", () => {
    assert.match(formatMoney("1234", "HUF"), /1[\s\u00a0]?234/);
    assert.equal(formatMoney("unknown", "HUF"), "unknown HUF");
  });

  it("does not render an invalid date", () => {
    assert.equal(formatDateTime("not-a-date"), "—");
  });
});
