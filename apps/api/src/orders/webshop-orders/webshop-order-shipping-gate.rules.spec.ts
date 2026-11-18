import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shippingGateRefusal,
  type ShippingGateFacts,
} from "./webshop-order-shipping-gate.rules.js";

const ready: ShippingGateFacts = {
  storePickup: false,
  invoiceNumber: "ACRW-2026/00600",
  hasParcel: true,
};

describe("shippingGateRefusal", () => {
  it("lets shipping through with an issued invoice and a confirmed parcel", () => {
    assert.equal(shippingGateRefusal("out_for_delivery", ready), null);
  });

  it("names exactly what is missing", () => {
    assert.match(
      shippingGateRefusal("out_for_delivery", {
        ...ready,
        invoiceNumber: null,
        hasParcel: false,
      }) ?? "",
      /Hiányzik: kiállított számla, feladott csomag\./,
    );
    assert.match(
      shippingGateRefusal("out_for_delivery", {
        ...ready,
        invoiceNumber: null,
      }) ?? "",
      /Hiányzik: kiállított számla\./,
    );
    assert.match(
      shippingGateRefusal("out_for_delivery", { ...ready, hasParcel: false }) ??
        "",
      /Hiányzik: feladott csomag\./,
    );
  });

  it("says why: the order of the steps, and that the card is charged on shipping", () => {
    assert.match(
      shippingGateRefusal("out_for_delivery", { ...ready, hasParcel: false }) ??
        "",
      /a kártyás levonás a Kiszállításra fut/,
    );
  });

  it("a store pickup is not gated, whatever it has", () => {
    assert.equal(
      shippingGateRefusal("out_for_delivery", {
        storePickup: true,
        invoiceNumber: null,
        hasParcel: false,
      }),
      null,
    );
  });

  it("no other step is gated", () => {
    for (const to of [
      "confirmed",
      "stocking",
      "ready_for_pickup",
      "closed",
      "closed_unsuccessfully",
    ] as const)
      assert.equal(
        shippingGateRefusal(to, {
          storePickup: false,
          invoiceNumber: null,
          hasParcel: false,
        }),
        null,
        to,
      );
  });
});
