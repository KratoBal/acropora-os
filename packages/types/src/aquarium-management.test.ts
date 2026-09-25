import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AQUARIUM_MEASUREMENT_PARAMETER_COLOR,
  AQUARIUM_MEASUREMENT_PARAMETERS,
  aquariumEffectiveMeasurementTargetRange,
  aquariumMeasurementParameter,
  aquariumMeasurementParametersFor,
  aquariumMeasurementTargetRange,
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

describe("aquariumMeasurementTargetRange", () => {
  it("tengerinél visszaadja a Figma tervből átvett tartományt", () => {
    assert.deepEqual(aquariumMeasurementTargetRange("TENGERI", "KH"), {
      min: 7,
      max: 9,
    });
    assert.deepEqual(aquariumMeasurementTargetRange("TENGERI", "PH"), {
      min: 8.1,
      max: 8.4,
    });
  });

  it("édesvízinél MINDIG undefined -- ezt szándékosan nem találtuk ki", () => {
    /*
      MI PIROSÍT: ha valaki egy tengeri tartományt visszaadna édesvízire is
      (pl. egy "ha nincs saját, essen vissza a közösre" kényelmi ág), ez az
      állítás azonnal elkapná -- lásd a konstans fejlécét, miért kártékony
      volna.
    */
    assert.equal(aquariumMeasurementTargetRange("EDESVIZI", "PH"), undefined);
    assert.equal(aquariumMeasurementTargetRange("EDESVIZI", "KH"), undefined);
    assert.equal(aquariumMeasurementTargetRange("EDESVIZI", "GH"), undefined);
  });

  it("víztípus nélkül undefined", () => {
    assert.equal(aquariumMeasurementTargetRange(null, "KH"), undefined);
    assert.equal(aquariumMeasurementTargetRange(undefined, "KH"), undefined);
  });
});

describe("aquariumEffectiveMeasurementTargetRange", () => {
  it("sajat tartomany eseten AZT adja, nem a kod-alapertelmezest", () => {
    // A SAJAT ERTEK ELTER a kodban allo TENGERI alapertektol (KH 7-9) --
    // ha a fuggveny tevedesbol az alapertelmezesre esne, ez az allitas
    // elkapna.
    assert.deepEqual(
      aquariumEffectiveMeasurementTargetRange("TENGERI", "KH", [
        { parameterCode: "KH", min: 6, max: 8 },
      ]),
      { min: 6, max: 8 },
    );
  });

  it("csak also hatarral rendelkezo sajat sor a felsot NEM tolti ki az alapertekbol", () => {
    /*
      MI PIROSÍT: ha a fuggveny a hianyzo also/felso oldalt a kod-
      alapertelmezesbol potolna, a `max` itt 9 lenne (a TENGERI KH
      alapertelmezes felso hatara), nem undefined.
    */
    const range = aquariumEffectiveMeasurementTargetRange("TENGERI", "KH", [
      { parameterCode: "KH", min: 6 },
    ]);
    assert.deepEqual(range, { min: 6, max: undefined });
  });

  it("sajat sor hianyaban a kod-alapertelmezesre esik vissza", () => {
    assert.deepEqual(
      aquariumEffectiveMeasurementTargetRange("TENGERI", "KH", []),
      { min: 7, max: 9 },
    );
    assert.deepEqual(
      aquariumEffectiveMeasurementTargetRange("TENGERI", "KH", undefined),
      { min: 7, max: 9 },
    );
  });

  it("sem sajat sor, sem alapertelmezes (edesvizi) -- undefined", () => {
    assert.equal(
      aquariumEffectiveMeasurementTargetRange("EDESVIZI", "KH", []),
      undefined,
    );
  });

  // TESTVÉR-KONTROLL: édesvízinél a SAJÁT tartomány AKKOR IS érvényesül,
  // ha a kód-alapértelmezés nem ismeri a paramétert -- a kétszintű
  // visszaesés első szintje nem a víztípustól függ, csak attól, van-e sor.
  it("edesvizinel is ervenyesul a sajat tartomany, holott alapertelmezes nincs", () => {
    assert.deepEqual(
      aquariumEffectiveMeasurementTargetRange("EDESVIZI", "PH", [
        { parameterCode: "PH", min: 6.5, max: 7.5 },
      ]),
      { min: 6.5, max: 7.5 },
    );
  });

  it("egy mas parameterre szolo sajat sor nem szivarog at", () => {
    assert.deepEqual(
      aquariumEffectiveMeasurementTargetRange("TENGERI", "PH", [
        { parameterCode: "KH", min: 6, max: 8 },
      ]),
      { min: 8.1, max: 8.4 },
    );
  });
});

describe("AQUARIUM_MEASUREMENT_PARAMETER_COLOR", () => {
  it("minden katalógus-paraméterhez tartozik szín", () => {
    for (const param of AQUARIUM_MEASUREMENT_PARAMETERS) {
      assert.ok(AQUARIUM_MEASUREMENT_PARAMETER_COLOR[param.code], param.code);
    }
  });

  it("nincs két azonos színű paraméter", () => {
    const szinek = Object.values(AQUARIUM_MEASUREMENT_PARAMETER_COLOR);
    assert.equal(new Set(szinek).size, szinek.length);
  });
});
