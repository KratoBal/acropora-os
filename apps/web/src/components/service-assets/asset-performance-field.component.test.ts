import { describe, expect, it } from "vitest";

import {
  performancePairProblem,
  performanceUnitOptions,
} from "./asset-performance-field";

const aktiv = (id: string, sortOrder = 0) => ({
  id,
  code: id.toUpperCase(),
  name: id,
  kind: "PERFORMANCE" as const,
  isActive: true,
  sortOrder,
});

const kivezetett = { ...aktiv("regi"), isActive: false };

describe("a teljesítmény mezője", () => {
  /**
   * EZ AZ AZ ALLITAS, AMIERT A FUGGVENY LETEZIK.
   *
   * Kivezetett egyseg mellett a legordulo a sajat erteket nem tudna
   * megmutatni, es a bongeszo az ELSO elemre esne vissza: a kezelo megnyitja
   * az adatlapot, egy szot sem ir, ment -- es a mertekegyseg megvaltozik.
   */
  it("a mostani egység akkor is bent van, ha kivezetett", () => {
    const options = performanceUnitOptions(
      [aktiv("w"), aktiv("kw")],
      kivezetett,
    );
    expect(options.map((unit) => unit.id)).toEqual(["w", "kw", "regi"]);
  });

  /** TESTVER-KONTROLL: nem duplikaljuk, ha amugy is ott van. */
  it("az aktív mostani egység nem kerül be kétszer", () => {
    const w = aktiv("w");
    const options = performanceUnitOptions([w, aktiv("kw")], w);
    expect(options.map((unit) => unit.id)).toEqual(["w", "kw"]);
  });

  it("egység nélküli eszköznél a lista változatlan", () => {
    const options = performanceUnitOptions([aktiv("w")], undefined);
    expect(options.map((unit) => unit.id)).toEqual(["w"]);
  });

  it("a teljes pár rendben van", () => {
    expect(performancePairProblem("500", "w", false)).toBeNull();
  });

  it("az üres pár is rendben van: nincs megadva teljesítmény", () => {
    expect(performancePairProblem("", "", false)).toBeNull();
  });

  it("szám mértékegység nélkül: a legördülőre mutat", () => {
    expect(performancePairProblem("500", "", false)).toBe("missing-unit");
  });

  it("mértékegység szám nélkül: a mezőre mutat", () => {
    expect(performancePairProblem("", "w", false)).toBe("missing-value");
  });

  /**
   * A SORREND: az alak-hiba ELOBB all. Egy "otszaz" beirasara a "valassz
   * mertekegyseget" mondat felrevezeto lenne, hiszen a SZAM a baj.
   */
  it("a hibás alak megelőzi a hiányzó mértékegységet", () => {
    expect(performancePairProblem("ötszáz", "", true)).toBe("malformed");
  });

  it("a hibás alak akkor is hibás, ha a mértékegység megvan", () => {
    expect(performancePairProblem("ötszáz", "w", true)).toBe("malformed");
  });
});
