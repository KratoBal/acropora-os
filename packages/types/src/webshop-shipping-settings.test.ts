import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseWebshopPaymentMatrixInput,
  parseWebshopShippingFeesInput,
  type WebshopPaymentMatrix,
} from "./webshop-shipping-settings.js";

/*
  A SZÁLLÍTÁSI DÍJAK ÉS A FIZETÉSI MÁTRIX BEMENETE (kártya e0e2378b). MI PIROSÍT: egy hiányzó, tört, negatív vagy túl nagy
  díj átjut; egy szállítási mód kimarad vagy üres listával megy (a pénztár semmit nem kínálna); egy fizetési mód kétszer
  szerepel; utánvét a személyes átvételnél vagy fizetés az üzletben futárnál átjut; a sorrend nem marad meg.
*/
const fees = {
  glsNormal: 3500,
  glsHeavy: 4500,
  foxpost: 1150,
  freeThresholdGls: 50000,
  freeThresholdFoxpost: 30000,
  cashOnDeliveryFee: 450,
};

// Balázs's matrix (2026-09-01), with the order the customer sees
const matrix: WebshopPaymentMatrix = {
  PICKUP: ["ONLINE_CARD", "PAY_AT_STORE", "BANK_TRANSFER"],
  GLS_NORMAL: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
  GLS_HEAVY: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
  FOXPOST: ["ONLINE_CARD", "COD", "BANK_TRANSFER"],
};

describe("parseWebshopShippingFeesInput", () => {
  it("accepts six whole, non-negative forint values, 0 included", () => {
    assert.deepEqual(parseWebshopShippingFeesInput({ ...fees, foxpost: 0 }), {
      ok: true,
      value: { ...fees, foxpost: 0 },
    });
  });
  it("refuses a missing, fractional, negative, too large or text value, by field", () => {
    for (const [over, field] of [
      [{ glsNormal: undefined }, "glsNormal"],
      [{ glsHeavy: 4500.5 }, "glsHeavy"],
      [{ foxpost: -1 }, "foxpost"],
      [{ freeThresholdGls: 1_000_001 }, "freeThresholdGls"],
      [{ cashOnDeliveryFee: "450" }, "cashOnDeliveryFee"],
    ] as const) {
      const parsed = parseWebshopShippingFeesInput({ ...fees, ...over });
      assert.equal(parsed.ok, false, JSON.stringify(over));
      if (!parsed.ok) {
        assert.deepEqual(Object.keys(parsed.errors), [field]);
      }
    }
  });
});

describe("parseWebshopPaymentMatrixInput", () => {
  it("accepts every shipping method with its payment methods, in the given order", () => {
    const reordered = {
      ...matrix,
      FOXPOST: ["COD", "BANK_TRANSFER", "ONLINE_CARD"],
    };
    assert.deepEqual(parseWebshopPaymentMatrixInput(reordered), {
      ok: true,
      value: reordered,
    });
  });
  it("refuses a missing or empty method, a duplicate, an unknown or an impossible payment, by shipping method", () => {
    for (const [over, field, text] of [
      [{ GLS_HEAVY: undefined }, "GLS_HEAVY", /Ismeretlen/],
      [{ FOXPOST: [] }, "FOXPOST", /Legalább egy/],
      [{ GLS_NORMAL: ["COD", "COD"] }, "GLS_NORMAL", /kétszer/],
      [{ GLS_NORMAL: ["CASH"] }, "GLS_NORMAL", /Ismeretlen/],
      [{ PICKUP: ["ONLINE_CARD", "COD"] }, "PICKUP", /nincs utánvét/],
      [{ FOXPOST: ["PAY_AT_STORE"] }, "FOXPOST", /nincs fizetés az üzletben/],
    ] as const) {
      const parsed = parseWebshopPaymentMatrixInput({ ...matrix, ...over });
      assert.equal(parsed.ok, false, JSON.stringify(over));
      if (!parsed.ok) {
        assert.deepEqual(Object.keys(parsed.errors), [field]);
        assert.match(parsed.errors[field]!, text);
      }
    }
  });
});
