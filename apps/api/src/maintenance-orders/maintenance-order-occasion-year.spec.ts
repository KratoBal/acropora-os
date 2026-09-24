import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maintenanceOrderOccasionYear } from "./maintenance-order-occasion-year.js";

describe("a kiállítás éve budapesti naptár szerint", () => {
  it("egy dél körüli időpontnál nincs eltérés", () => {
    assert.equal(
      maintenanceOrderOccasionYear(new Date("2026-06-15T10:00:00.000Z")),
      2026,
    );
  });

  /**
   * MI PIROSÍT: egy UTC-alapú `getFullYear()`. December 31-én késő este
   * (Budapesten, CET, UTC+1) a 23:30 UTC MÁR a következő év január 1-je
   * Budapesten -- egy UTC-s olvasás a régi évet mondaná, és egy ilyenkor
   * kiállított megrendelőlap a MEGELŐZŐ év "alkalom-keretét" fogyasztaná,
   * nem az újét.
   */
  it("szilveszterkor a Budapesten már új év UTC szerint még nem az", () => {
    assert.equal(
      maintenanceOrderOccasionYear(new Date("2026-12-31T23:30:00.000Z")),
      2027,
      "23:30 UTC dec 31-én Budapesten (CET, UTC+1) már január 1. hajnal",
    );
  });

  /**
   * A TÜKÖRKÉP: december 31-én KORÁBBAN, amikor a budapesti eltolás (CET,
   * UTC+1) MÉG NEM tolja át éjfélen -- ez zárja ki, hogy az őrző csak
   * "mindig előre ugrik egy évet" logikára épüljön, ha véletlenül december
   * 31-i dátumot lát.
   */
  it("december 31-én korábban, ahol az eltolás még nem lép át éjfélen, a régi évnél marad", () => {
    assert.equal(
      maintenanceOrderOccasionYear(new Date("2026-12-31T20:00:00.000Z")),
      2026,
      "20:00 UTC dec 31-én Budapesten (CET, UTC+1) még 21:00, ugyanaznap",
    );
  });
});
