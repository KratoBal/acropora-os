import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  legacyPowerConsumptionToRaw,
  rawWithLegacyFallback,
} from "./legacy-power-consumption.js";

describe("a kivezetett powerConsumption kulcs átvétele", () => {
  it("a régi szám a migráció magyar alakját kapja", () => {
    assert.equal(legacyPowerConsumptionToRaw("0.75"), "0,75 kW");
    assert.equal(legacyPowerConsumptionToRaw("0,75"), "0,75 kW");
    assert.equal(legacyPowerConsumptionToRaw("500"), "500 kW");
    assert.equal(legacyPowerConsumptionToRaw("0.750000"), "0,75 kW");
    assert.equal(legacyPowerConsumptionToRaw("500.000000"), "500 kW");
    assert.equal(legacyPowerConsumptionToRaw(" 5.5 "), "5,5 kW");
    assert.equal(legacyPowerConsumptionToRaw("0"), "0 kW");
  });

  it("ami nem sima szám, azt nem találgatja", () => {
    for (const rossz of [
      "6,15/5,5",
      "abc",
      "",
      "  ",
      "-1",
      "1e3",
      null,
      undefined,
      5,
      {},
    ])
      assert.equal(legacyPowerConsumptionToRaw(rossz), null, String(rossz));
  });

  it("a kitöltött eredeti bejegyzés NYER, az üres kap", () => {
    // a kérés maga hoz eredetit: az marad
    assert.equal(
      rawWithLegacyFallback("6,15/5,5", null, "0,75 kW"),
      "6,15/5,5",
    );
    // a kérés nem említi, a tárolt kitöltött: marad (nem írunk semmit)
    assert.equal(
      rawWithLegacyFallback(undefined, "6,15/5,5", "0,75 kW"),
      undefined,
    );
    // a kérés nem említi, a tárolt üres vagy csak szóköz: kapja a régit
    assert.equal(rawWithLegacyFallback(undefined, null, "0,75 kW"), "0,75 kW");
    assert.equal(rawWithLegacyFallback(undefined, "  ", "0,75 kW"), "0,75 kW");
    // a kérés üresre állítja: kapja a régit
    assert.equal(rawWithLegacyFallback(null, "x", "0,75 kW"), "0,75 kW");
  });

  it("régi kulcs nélkül semmi nem változik", () => {
    assert.equal(rawWithLegacyFallback(undefined, null, null), undefined);
    assert.equal(rawWithLegacyFallback(null, "x", null), null);
    assert.equal(rawWithLegacyFallback("a", "b", null), "a");
  });
});
