import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  maintenanceOrderLocationView,
  maintenanceOrderVisibleToScope,
} from "./maintenance-order-visibility.js";

describe("a megrendelőlap tételeinek helyszín-nézete", () => {
  it("egy helyszínre mutató tételekből egyetlen azonosítót ad", () => {
    const view = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
      { contractItem: { departmentId: "d1" } },
    ]);
    assert.deepEqual(view.departmentIds, ["d1"]);
    assert.equal(view.hasCustomerWideItem, false);
  });

  it("egy helyszín nélküli tétel jelzi a vevő-szintű ágat", () => {
    const view = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
      { contractItem: { departmentId: null } },
    ]);
    assert.deepEqual(view.departmentIds, ["d1"]);
    assert.equal(view.hasCustomerWideItem, true);
  });

  it("több különböző helyszínt egyedi listaként ad vissza", () => {
    const view = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
      { contractItem: { departmentId: "d2" } },
    ]);
    assert.deepEqual([...view.departmentIds].sort(), ["d1", "d2"]);
  });
});

describe("a megrendelőlap láthatósága a portál hívó hatókörében", () => {
  /**
   * ACROBOT SZABÁLYA (msg_id 23868): minden tétel helyszíne a hívó
   * hatókörében legyen. Ez a KÖZPONTI, mai eset -- a `ensureSingleDepartment`
   * miatt ma minden létező rendelés ide esik.
   */
  it("egy helyszínre mutató rendelést csak a helyszínt látó hívó lát", () => {
    const location = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
    ]);
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d1", "d2"],
        customerCovered: false,
      }),
      true,
    );
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d2"],
        customerCovered: false,
      }),
      false,
    );
  });

  /**
   * MI PIROSÍT: a "csak az első tétel helyszíne" szabály (a saját, elvetett
   * tervjavaslatom) -- egy A helyszínre hozzárendelt hívó ekkor látná az
   * olyan rendelést is, ami B helyszín tételét is hordozza. Ez az állítás
   * pontosan ezt a szivárgást zárja ki: TÖBB helyszín esetén MINDNEK a
   * hatókörben kell lennie.
   */
  it("több helyszínre mutató rendelést csak az MINDET látó hívó lát", () => {
    const location = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
      { contractItem: { departmentId: "d2" } },
    ]);
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d1", "d2", "d3"],
        customerCovered: false,
      }),
      true,
    );
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d1"],
        customerCovered: false,
      }),
      false,
      "az A helyszínre hozzárendelt hívó nem láthatja a B helyszínt is hordozó rendelést",
    );
  });

  it("egy helyszín nélküli tételt hordozó rendelést csak a teljes ügyfelet lefedő hívó lát", () => {
    const location = maintenanceOrderLocationView([
      { contractItem: { departmentId: null } },
    ]);
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d1", "d2"],
        customerCovered: true,
      }),
      true,
    );
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: ["d1", "d2"],
        customerCovered: false,
      }),
      false,
    );
  });

  it("üres hatókörű hívó semmit nem lát", () => {
    const location = maintenanceOrderLocationView([
      { contractItem: { departmentId: "d1" } },
    ]);
    assert.equal(
      maintenanceOrderVisibleToScope(location, {
        unitIds: [],
        customerCovered: false,
      }),
      false,
    );
  });
});
