import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foxpostPointType } from "./webshop-orders.js";

/*
  THE FOXPOST POINT'S TYPE IN THE CUSTOMER'S WORDS, as the storefront writes
  it (commerce #498, `foxpostPontTipus`; the cases are its own). WHAT TURNS
  RED: a Z-BOX or a Z-Pont shows as a FOXPOST automata (the Foxpost label of a
  Z-BOX also starts with "FOXPOST"); an unknown type becomes an automata.
*/
describe("foxpostPointType", () => {
  it("names the three Foxpost types the way the storefront does", () => {
    assert.equal(foxpostPointType("FOXPOST A-BOX"), "FOXPOST automata");
    assert.equal(foxpostPointType("FOXPOST Z-BOX"), "Packeta Z-BOX");
    assert.equal(
      foxpostPointType("Packeta Z-Pont"),
      "Packeta Z-Pont / átvevőhely",
    );
    assert.equal(foxpostPointType("FOXPOST"), "FOXPOST automata");
    assert.equal(foxpostPointType("Z-BOX"), "Packeta Z-BOX");
    assert.equal(foxpostPointType("z-pont"), "Packeta Z-Pont / átvevőhely");
  });

  it("a Z-BOX is never an automata; an unknown type keeps Foxpost's words", () => {
    assert.ok(!foxpostPointType("FOXPOST Z-BOX").includes("automata"));
    assert.equal(
      foxpostPointType("  FOXPOST Csomagpont  "),
      "FOXPOST Csomagpont",
    );
    assert.equal(foxpostPointType(null), "");
  });
});
