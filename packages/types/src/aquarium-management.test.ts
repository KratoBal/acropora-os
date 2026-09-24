import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AQUARIUM_MEASUREMENT_PARAMETERS,
  aquariumMeasurementParameter,
  aquariumMeasurementParametersFor,
} from "./aquarium-management.js";

describe("aquariumMeasurementParametersFor", () => {
  it("víztípus nélkül MIND a 17 paramétert adja", () => {
    /*
      POZITÍV KONTROLL A KATALÓGUS MÉRETÉRE: e nélkül egy véletlenül
      lecsökkent katalógus is átmenne a lenti szűrő-állításokon.
    */
    assert.equal(AQUARIUM_MEASUREMENT_PARAMETERS.length, 17);
    assert.equal(aquariumMeasurementParametersFor(null).length, 17);
    assert.equal(aquariumMeasurementParametersFor(undefined).length, 17);
  });

  it("tengeri víztípusnál a sótartalom/sűrűség benne van, a GH nincs", () => {
    const kodok = aquariumMeasurementParametersFor("TENGERI").map(
      (p) => p.code,
    );
    assert.ok(kodok.includes("SOTARTALOM"));
    assert.ok(kodok.includes("SURUSEG"));
    assert.ok(kodok.includes("ORP"));
    /*
      MI PIROSÍT: ha a szűrés nem víztípus szerint menne, hanem mindig
      mindent adna vissza -- ez a negatív állítás fogja meg.
    */
    assert.ok(!kodok.includes("GH"));
    assert.ok(!kodok.includes("VAS"));
  });

  it("édesvízi víztípusnál a GH/vas/réz benne van, a sótartalom nincs", () => {
    const kodok = aquariumMeasurementParametersFor("EDESVIZI").map(
      (p) => p.code,
    );
    assert.ok(kodok.includes("GH"));
    assert.ok(kodok.includes("VAS"));
    assert.ok(kodok.includes("REZ"));
    assert.ok(kodok.includes("VEZETOKEPESSEG"));
    assert.ok(!kodok.includes("SOTARTALOM"));
    assert.ok(!kodok.includes("SURUSEG"));
    assert.ok(!kodok.includes("ORP"));
  });

  it("a hőmérséklet, pH és KH mindkét víztípusnál szerepel", () => {
    for (const waterType of ["EDESVIZI", "TENGERI"] as const) {
      const kodok = aquariumMeasurementParametersFor(waterType).map(
        (p) => p.code,
      );
      assert.ok(kodok.includes("HOMERSEKLET"), waterType);
      assert.ok(kodok.includes("PH"), waterType);
      assert.ok(kodok.includes("KH"), waterType);
    }
  });
});

describe("aquariumMeasurementParameter", () => {
  it("minden katalógus-kódra visszaadja a saját definícióját", () => {
    for (const param of AQUARIUM_MEASUREMENT_PARAMETERS) {
      assert.deepEqual(aquariumMeasurementParameter(param.code), param);
    }
  });

  it("az egység a paraméterhez van kötve, nem választható", () => {
    assert.equal(aquariumMeasurementParameter("PH").unit, "pH");
    assert.equal(aquariumMeasurementParameter("KH").unit, "dKH");
    assert.equal(aquariumMeasurementParameter("SOTARTALOM").unit, "ppt");
    assert.equal(aquariumMeasurementParameter("VEZETOKEPESSEG").unit, "µS/cm");
  });
});
