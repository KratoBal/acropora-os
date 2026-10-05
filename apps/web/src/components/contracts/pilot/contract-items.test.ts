import { describe, expect, it } from "vitest";

import {
  repairFeeSummary,
  repairFeesPayload,
  repairFeesValid,
} from "./contract-items";

/*
  A JAVÍTÁSI DÍJAK (kártya 3d80a18d). MI PIROSÍT: ha egy szóközzel vagy
  tizedesvesszővel beírt szám a szerver számalakja helyett elmegy (400 angolul);
  ha az üres mező üres sztringként megy, nem törlésként; ha betű átmegy; ha az
  adatlap sora a kitöltetlen díjat is kiírja.
*/
describe("a javítási díjak", () => {
  it("a beírt szám a szerver alakjára megy, az üres null", () => {
    expect(
      repairFeesPayload({
        repairFeeWorkdayHours: "9 000",
        repairFeeHoliday: "14500,5",
        repairWeight: "90",
        repairTotal: "",
      }),
    ).toEqual({
      repairFeeWorkdayHours: "9000",
      repairFeeWorkdayOffHours: null,
      repairFeeHoliday: "14500.5",
      repairWeight: "90",
      repairTotal: null,
    });
  });

  it("betű nem szám, a hiányzó és az üres rendben van", () => {
    expect(repairFeesValid({ repairTotal: "10 125 000" })).toBe(true);
    expect(repairFeesValid({ repairTotal: "" })).toBe(true);
    expect(repairFeesValid({})).toBe(true);
    expect(repairFeesValid({ repairWeight: "kilencven" })).toBe(false);
  });

  it("az adatlap sora csak a kitöltöttet mondja, kitöltetlen díjnál nincs sor", () => {
    expect(
      repairFeeSummary(
        {
          repairFeeWorkdayHours: "9000",
          repairWeight: "90",
          repairTotal: null,
        },
        (v) => v,
      ),
    ).toBe("Javítási díjak: munkaidőben 9000 Ft · súlyszám 90");
    expect(repairFeeSummary({}, (v) => v)).toBeNull();
  });
});
