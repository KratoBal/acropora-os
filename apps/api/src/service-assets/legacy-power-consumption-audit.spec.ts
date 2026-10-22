import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { carriesLegacyPowerConsumption } from "./legacy-power-consumption-audit.js";

describe("a kivezetett powerConsumption kulcs jelenléte a kérésben", () => {
  it("bármilyen érték jelzi, a null és az üres szöveg is", () => {
    assert.equal(
      carriesLegacyPowerConsumption({ powerConsumption: "0.75" }),
      true,
    );
    assert.equal(
      carriesLegacyPowerConsumption({ powerConsumption: null }),
      true,
    );
    assert.equal(carriesLegacyPowerConsumption({ powerConsumption: "" }), true);
    assert.equal(carriesLegacyPowerConsumption({ powerConsumption: 0 }), true);
  });

  it("a kulcs hiánya és az undefined nem jelzi", () => {
    assert.equal(carriesLegacyPowerConsumption({}), false);
    assert.equal(
      carriesLegacyPowerConsumption({ powerConsumption: undefined }),
      false,
    );
    assert.equal(
      carriesLegacyPowerConsumption({ powerConsumptionRaw: "3 kW" }),
      false,
    );
  });
});
