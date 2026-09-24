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

  it("a napot BUDAPESTI NAPTÁR szerint mondja ki, nem UTC szerint", () => {
    /*
      MI PIROSÍT: egy UTC-alapú levágás (`toISOString().slice(0, 10)` vagy
      `getUTCFullYear/Month/Date`). Egy 22:30 UTC bélyeg NYÁRON (UTC+2)
      Budapesten már 00:30, tehát MÁSNAP van -- egy alá- és visszaküldött
      megrendelőlapon a "Kelt" sor a ROSSZ napot mutatná.

      Ugyanez a hiba állt a `worksheet-sheet-content.ts` saját `sheetDate()`-je
      elé, mielőtt Europe/Budapest zónával formázna -- ez a mérce most már
      itt is él, nem csak ott.
    */
    assert.equal(
      formatOrderFormDate("2026-07-28T22:30:00.000Z"),
      "2026-07-29",
      "nyáron (CEST, UTC+2) a 22:30 UTC már másnap van Budapesten",
    );
    // TÉLI KONTROLL (CET, UTC+1): 22:30 UTC ilyenkor MÉG aznap van
    // Budapesten -- ha az őrző télen is másnapra ugorna, az órarendet nézné
    // a zóna helyett.
    assert.equal(
      formatOrderFormDate("2026-01-15T22:30:00.000Z"),
      "2026-01-15",
      "télen (CET, UTC+1) a 22:30 UTC még aznap van Budapesten",
    );
  });
});
