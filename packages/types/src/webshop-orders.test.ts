import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foxpostPointType, webshopCardPaymentLabel } from "./webshop-orders.js";

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

/*
  THE CARD PAYMENT'S LABEL ON THE ORDER PAGE (card d31a66a3, nautilus 63452). The cases are the shapes of the test shop's orders 160 and 161
  (card `paid`, no link, payment REFUNDED), 37 (PARTIALLY_REFUNDED) and a paid one nobody refunded. WHAT TURNS RED: a refunded card order
  reads "Linken fizetve"; a card paid without any link reads "Linken fizetve"; a paid-after-link order loses that wording; a state other than
  `paid` changes its label because of the refund.
*/
describe("webshopCardPaymentLabel", () => {
  it("a refunded card order says so, whole or partial", () => {
    assert.equal(
      webshopCardPaymentLabel({ state: "paid", link: null }, "REFUNDED"),
      "Visszatérítve",
    );
    assert.equal(
      webshopCardPaymentLabel(
        { state: "paid", link: null },
        "PARTIALLY_REFUNDED",
      ),
      "Részben visszatérítve",
    );
    assert.equal(
      webshopCardPaymentLabel(
        { state: "paid", link: { url: "x" } },
        "REFUNDED",
      ),
      "Visszatérítve",
    );
  });

  it("a paid card order without a link was charged from the card; one paid after a link says Linken fizetve", () => {
    assert.equal(
      webshopCardPaymentLabel({ state: "paid", link: null }, "CAPTURED"),
      "Kártyáról levonva",
    );
    assert.equal(
      webshopCardPaymentLabel({ state: "paid", link: null }, null),
      "Kártyáról levonva",
    );
    assert.equal(
      webshopCardPaymentLabel(
        { state: "paid", link: { url: "x" } },
        "CAPTURED",
      ),
      "Linken fizetve",
    );
  });

  it("the other card states keep their own label whatever the payment state is", () => {
    assert.equal(
      webshopCardPaymentLabel({ state: "hold", link: null }, "AUTHORIZED"),
      "Zárolva",
    );
    assert.equal(
      webshopCardPaymentLabel(
        { state: "link_sent", link: { url: "x" } },
        "REFUNDED",
      ),
      "Fizetési link elküldve",
    );
    assert.equal(
      webshopCardPaymentLabel({ state: "expired", link: null }, undefined),
      "A fizetési link lejárt",
    );
  });
});
