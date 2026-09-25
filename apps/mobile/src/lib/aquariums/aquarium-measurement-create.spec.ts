import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AQUARIUM_MEASUREMENT_PARAMETERS,
  aquariumMeasurementParameter,
  aquariumMeasurementParametersFor,
  buildAquariumMeasurementPayload,
  combineDateAndTime,
  emptyAquariumMeasurementForm,
  normalizeMeasurementValueText,
  type AquariumMeasurementForm,
} from "./aquarium-measurement-create";

describe("aquariumMeasurementParametersFor", () => {
  it("víztípus nélkül minden paramétert ad", () => {
    assert.equal(
      aquariumMeasurementParametersFor(null).length,
      AQUARIUM_MEASUREMENT_PARAMETERS.length,
    );
    assert.equal(
      aquariumMeasurementParametersFor(undefined).length,
      AQUARIUM_MEASUREMENT_PARAMETERS.length,
    );
  });

  /**
   * KALIBRÁCIÓ: a TENGERI és az ÉDESVÍZI halmaz különbözik -- ha a szűrés
   * véletlenül mindig a teljes listát adná vissza, ez a két állítás
   * ugyanazt a hosszt és ugyanazokat a kódokat találná.
   */
  it("TENGERI víztípusnál a sótartalom szerepel, a GH nem", () => {
    const kodok = aquariumMeasurementParametersFor("TENGERI").map(
      (p) => p.code,
    );
    assert.ok(kodok.includes("SOTARTALOM"));
    assert.ok(!kodok.includes("GH"));
  });

  it("EDESVIZI víztípusnál a GH szerepel, a sótartalom nem", () => {
    const kodok = aquariumMeasurementParametersFor("EDESVIZI").map(
      (p) => p.code,
    );
    assert.ok(kodok.includes("GH"));
    assert.ok(!kodok.includes("SOTARTALOM"));
  });

  it("a hőmérséklet és a pH mindkét víztípusnál szerepel", () => {
    for (const waterType of ["EDESVIZI", "TENGERI"] as const) {
      const kodok = aquariumMeasurementParametersFor(waterType).map(
        (p) => p.code,
      );
      assert.ok(kodok.includes("HOMERSEKLET"));
      assert.ok(kodok.includes("PH"));
    }
  });
});

describe("emptyAquariumMeasurementForm", () => {
  it("a sorok a szűrt paraméter-listát követik, üres szöveggel", () => {
    const form = emptyAquariumMeasurementForm("EDESVIZI");
    const vart = aquariumMeasurementParametersFor("EDESVIZI");
    assert.equal(form.values.length, vart.length);
    assert.deepEqual(
      form.values.map((v) => v.parameterCode),
      vart.map((p) => p.code),
    );
    assert.ok(form.values.every((v) => v.text === ""));
  });

  it("a mérés ideje a kapott 'most'-ra áll, érintetlenül", () => {
    const most = new Date(2026, 8, 25, 8, 0, 0);
    const form = emptyAquariumMeasurementForm("EDESVIZI", most);
    assert.equal(form.measuredAtDate.getTime(), most.getTime());
    assert.equal(form.measuredAtTouched, false);
  });
});

describe("combineDateAndTime", () => {
  const alap = new Date(2026, 8, 20, 14, 30, 0);

  it("a 'date' rész csak a napot cseréli, az órát megtartja", () => {
    const ujNap = new Date(2026, 8, 24, 9, 0, 0);
    const eredmeny = combineDateAndTime(alap, ujNap, "date");
    assert.equal(eredmeny.getFullYear(), 2026);
    assert.equal(eredmeny.getMonth(), 8);
    assert.equal(eredmeny.getDate(), 24);
    assert.equal(eredmeny.getHours(), 14);
    assert.equal(eredmeny.getMinutes(), 30);
  });

  it("a 'time' rész csak az órát cseréli, a napot megtartja", () => {
    const ujIdo = new Date(2020, 0, 1, 7, 15, 0);
    const eredmeny = combineDateAndTime(alap, ujIdo, "time");
    assert.equal(eredmeny.getFullYear(), 2026);
    assert.equal(eredmeny.getMonth(), 8);
    assert.equal(eredmeny.getDate(), 20);
    assert.equal(eredmeny.getHours(), 7);
    assert.equal(eredmeny.getMinutes(), 15);
  });
});

describe("normalizeMeasurementValueText", () => {
  it("vesszőt pontra cserél", () => {
    assert.equal(normalizeMeasurementValueText("7,8"), 7.8);
  });
  it("üres szövegre null", () => {
    assert.equal(normalizeMeasurementValueText(""), null);
    assert.equal(normalizeMeasurementValueText("   "), null);
  });
  it("nem szám alakra null", () => {
    assert.equal(normalizeMeasurementValueText("magas"), null);
  });
  /**
   * KALIBRÁCIÓ: a vízértékek tágabb tartományúak, mint az akvárium mérete
   * (pl. vezetőképesség 500 fölött is lehet, négy tizedesig). Ha ez a
   * függvény véletlenül az `aquarium-create.ts` szűkebb mintáját örökölné,
   * ez az állítás null-t adna.
   */
  it("nagy, négy tizedesjegyű értéket is elfogad", () => {
    assert.equal(normalizeMeasurementValueText("1234567.8912"), 1234567.8912);
  });
});

describe("buildAquariumMeasurementPayload", () => {
  function form(
    overrides: Partial<AquariumMeasurementForm> = {},
  ): AquariumMeasurementForm {
    return {
      notes: "",
      values: [
        { parameterCode: "HOMERSEKLET", text: "" },
        { parameterCode: "PH", text: "" },
        { parameterCode: "KH", text: "" },
      ],
      measuredAtDate: new Date(2026, 8, 25, 8, 0, 0),
      measuredAtTouched: false,
      ...overrides,
    };
  }

  it("minden mező üresen elutasít", () => {
    const result = buildAquariumMeasurementPayload(form());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "values");
  });

  /**
   * KALIBRÁCIÓ: a KH mezőt üresen hagyva NEM kerül be a törzsbe. Ha a
   * szűrés hiányozna, ez az állítás a törzsben `values.length === 3`-at
   * találna 2 helyett.
   */
  it("csak a kitöltött paraméterek kerülnek a törzsbe", () => {
    const result = buildAquariumMeasurementPayload(
      form({
        values: [
          { parameterCode: "HOMERSEKLET", text: "25.5" },
          { parameterCode: "PH", text: "7,8" },
          { parameterCode: "KH", text: "" },
        ],
      }),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.payload.values, [
      { parameterCode: "HOMERSEKLET", value: 25.5 },
      { parameterCode: "PH", value: 7.8 },
    ]);
  });

  it("érvénytelen szám a kitöltött mezőben elutasít, a hibás sort nevezi meg", () => {
    const result = buildAquariumMeasurementPayload(
      form({
        values: [
          { parameterCode: "HOMERSEKLET", text: "25.5" },
          { parameterCode: "PH", text: "nem szám" },
          { parameterCode: "KH", text: "" },
        ],
      }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.field, "values.1");
  });

  it("a megjegyzés üresen undefined, kitöltve átmegy", () => {
    const ures = buildAquariumMeasurementPayload(
      form({ values: [{ parameterCode: "PH", text: "7" }] }),
    );
    assert.equal(ures.ok, true);
    if (ures.ok) assert.equal(ures.payload.notes, undefined);

    const kitoltott = buildAquariumMeasurementPayload(
      form({
        notes: "  Vízcsere után  ",
        values: [{ parameterCode: "PH", text: "7" }],
      }),
    );
    assert.equal(kitoltott.ok, true);
    if (kitoltott.ok) assert.equal(kitoltott.payload.notes, "Vízcsere után");
  });

  describe("a mérés ideje", () => {
    it("érintetlenül a törzs measuredAt-je undefined -- a hívó a mentés pillanatát írja", () => {
      const result = buildAquariumMeasurementPayload(
        form({ values: [{ parameterCode: "PH", text: "7" }] }),
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.payload.measuredAt, undefined);
    });

    it("hozzányúlva a törzs a választott időt viszi, ISO alakban", () => {
      const valasztott = new Date(2020, 0, 1, 9, 30, 0);
      const result = buildAquariumMeasurementPayload(
        form({
          measuredAtDate: valasztott,
          measuredAtTouched: true,
          values: [{ parameterCode: "PH", text: "7" }],
        }),
      );
      assert.equal(result.ok, true);
      if (result.ok)
        assert.equal(result.payload.measuredAt, valasztott.toISOString());
    });

    /**
     * KALIBRÁCIÓ: a `measuredAtTouched: false` ág FUT LE elsőnek egy jövőbeli
     * `measuredAtDate` mellett is -- ha a jövő-ellenőrzés a `touched`
     * feltétel nélkül állna, ez az állítás pirosodna, mert az alap `form()`
     * dátuma önmagában is lehet a jövőben egy másik gépi órán.
     */
    it("érintetlen jövőbeli measuredAtDate nem utasít el semmit", () => {
      const result = buildAquariumMeasurementPayload(
        form({
          measuredAtDate: new Date(Date.now() + 60_000),
          values: [{ parameterCode: "PH", text: "7" }],
        }),
      );
      assert.equal(result.ok, true);
    });

    it("hozzányúlva jövőbeli időpontra elutasít, a mezőt megnevezve", () => {
      const result = buildAquariumMeasurementPayload(
        form({
          measuredAtDate: new Date(Date.now() + 60_000),
          measuredAtTouched: true,
          values: [{ parameterCode: "PH", text: "7" }],
        }),
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.field, "measuredAt");
        assert.equal(result.message, "A mérés ideje nem lehet a jövőben.");
      }
    });
  });
});

describe("aquariumMeasurementParameter", () => {
  it("minden katalógus-kódra megtalálja a saját definícióját", () => {
    for (const param of AQUARIUM_MEASUREMENT_PARAMETERS)
      assert.deepEqual(aquariumMeasurementParameter(param.code), param);
  });

  it("a pH címkéje és egysége helyes", () => {
    const ph = aquariumMeasurementParameter("PH");
    assert.equal(ph.label, "pH");
    assert.equal(ph.unit, "pH");
  });
});
