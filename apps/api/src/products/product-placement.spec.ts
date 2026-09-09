import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { adviseProductPlacement } from "./product-placement.js";

const baseline = {
  aquarium: {
    heightCm: 60,
    lampWatt: 60,
    lampType: "LED" as const,
    flow: "EROS" as const,
  },
  product: { fenyIgeny: "KOZEPES" as const, aramlasIgeny: "KOZEPES" as const },
};

describe("adviseProductPlacement", () => {
  it("közepes fényigénynél a középső harmadot és a termék saját áramlási zónáját adja", () => {
    const result = adviseProductPlacement(baseline);

    assert.equal(result.kind, "recommendation");
    if (result.kind !== "recommendation") return;
    assert.equal(result.heightBand, "KOZEPSO_HARMAD");
    assert.equal(result.flowZone, "KOZEPES");
    assert.equal(result.flowComparison.relation, "HIGHER_THAN_PRODUCT_NEED");
  });

  it("a wattos válasz saját, látható LED-átváltást és mélységi becslést hordoz", () => {
    const result = adviseProductPlacement({
      ...baseline,
      aquarium: { ...baseline.aquarium, lampType: "T5", lampWatt: 40 },
    });

    assert.equal(result.kind, "recommendation");
    if (result.kind !== "recommendation") return;
    assert.equal(result.lightEstimate.measurement, "WATT_BECSLES_NEM_MERES");
    assert.equal(
      result.lightEstimate.lampConversion.factorToLedReferenceWatt,
      0.55,
    );
    assert.equal(result.lightEstimate.ledReferenceWatt, 22);
    assert.match(result.lightEstimate.depthCalculation.formula, /melysegArany/);
  });

  it("erős fényigénynél ugyanazon lámpa felső harmadát választja", () => {
    const result = adviseProductPlacement({
      ...baseline,
      aquarium: { ...baseline.aquarium, lampWatt: 90 },
      product: { ...baseline.product, fenyIgeny: "EROS" },
    });

    assert.equal(result.kind, "recommendation");
    if (result.kind !== "recommendation") return;
    assert.equal(result.heightBand, "FELSO_HARMAD");
  });

  it("hiányzó fényigénynél nem ajánl, hanem kizárólag a hiányzó mezőt nevezi meg", () => {
    assert.deepEqual(
      adviseProductPlacement({
        ...baseline,
        product: { ...baseline.product, fenyIgeny: null },
      }),
      { kind: "missingProductFields", fields: ["fenyIgeny"] },
    );
  });

  it("mindkét hiányzó adatot nevezi meg, és akkor sem talál ki zónát", () => {
    assert.deepEqual(
      adviseProductPlacement({
        ...baseline,
        product: { fenyIgeny: null, aramlasIgeny: null },
      }),
      { kind: "missingProductFields", fields: ["fenyIgeny", "aramlasIgeny"] },
    );
  });

  it("nem értelmezhető fényigénynél nem ajánl és nem mondja hiányzónak", () => {
    assert.deepEqual(
      adviseProductPlacement({
        ...baseline,
        product: { ...baseline.product, fenyIgeny: "NEM_ERTELMEZHETO" },
      }),
      {
        kind: "notApplicableProductFields",
        fields: [
          {
            field: "fenyIgeny",
            state: "NEM_ERTELMEZHETO",
            reason: "A termékhez ez az elhelyezési szempont nem alkalmazható.",
          },
        ],
      },
    );
  });

  it("nem értelmezhető áramlásigénynél a megfelelő mezőt nevezi meg", () => {
    assert.deepEqual(
      adviseProductPlacement({
        ...baseline,
        product: {
          ...baseline.product,
          aramlasIgeny: "NEM_ERTELMEZHETO",
        },
      }),
      {
        kind: "notApplicableProductFields",
        fields: [
          {
            field: "aramlasIgeny",
            state: "NEM_ERTELMEZHETO",
            reason: "A termékhez ez az elhelyezési szempont nem alkalmazható.",
          },
        ],
      },
    );
  });
});

/*
 * Kalibráció (2026-09-09; a teljes API-unit futás száma a leadási jegyzetben):
 *
 * 1. A `flowZone: input.product.aramlasIgeny` rontása `input.aquarium.flow`-ra
 *    pontosan az első teszt flowZone-állítását döntötte pirosra.
 * 2. A T5-szorzó 0.55-ről 1-re rontása pontosan a második teszt szorzó-állítását
 *    döntötte pirosra.
 * 3. Az erős igény döntetlen-szabályának megfordítása pontosan a harmadik teszt
 *    magassági-sáv állítását döntötte pirosra.
 * 4. A hiányzó-fény mező felvételének kihagyása pontosan a negyedik teszt deepEqual-jét
 *    döntötte pirosra.
 * 5. A mélységi-szövegben a harmadok emberi címkéjének átírása NULLA pirosat
 *    adott: ez a szándékos lelet. A számolt mélységi arány és a kimeneti képlet
 *    őrzött, a kizárólag kijelzési mondat pontos szövege viszont nincs teszttel
 *    rögzítve.
 * 6. A `fenyIgeny === "NEM_ERTELMEZHETO"` ág rontása pontosan a hatodik teszt
 *    deepEqual-jét döntötte pirosra; az áramlás-mező külön ágon áll, ezért
 *    annak tesztje zöld maradt.
 */
