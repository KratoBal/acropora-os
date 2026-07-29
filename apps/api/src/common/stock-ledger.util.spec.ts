import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  classifyLedgerMovements,
  sumOrderBookedOut,
  type LedgerMovement,
} from "./stock-ledger.util.js";

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe("classifyLedgerMovements", () => {
  it("sums PURCHASE_RECEIPT positively and SALE negatively for the same variant", () => {
    const movements: LedgerMovement[] = [
      { type: "PURCHASE_RECEIPT", lines: [{ variantId: "v1", quantity: d("10") }] },
      { type: "SALE", lines: [{ variantId: "v1", quantity: d("4") }] },
    ];
    const result = classifyLedgerMovements(movements);
    assert.equal(result.provableNetByVariant.get("v1")?.toString(), "6");
    assert.equal(result.unprovableVariantIds.has("v1"), false);
  });

  it("sums RETURN_IN positively and RETURN_OUT negatively", () => {
    const movements: LedgerMovement[] = [
      { type: "RETURN_IN", lines: [{ variantId: "v1", quantity: d("3") }] },
      { type: "RETURN_OUT", lines: [{ variantId: "v1", quantity: d("1") }] },
    ];
    const result = classifyLedgerMovements(movements);
    assert.equal(result.provableNetByVariant.get("v1")?.toString(), "2");
  });

  it("marks a variant unprovable when any ADJUSTMENT movement touches it - sign is not recoverable", () => {
    const movements: LedgerMovement[] = [
      { type: "PURCHASE_RECEIPT", lines: [{ variantId: "v1", quantity: d("10") }] },
      { type: "ADJUSTMENT", lines: [{ variantId: "v1", quantity: d("2") }] },
    ];
    const result = classifyLedgerMovements(movements);
    assert.equal(result.unprovableVariantIds.has("v1"), true);
  });

  it("marks a variant unprovable for an unrecognized/future movement type instead of guessing a sign", () => {
    const movements: LedgerMovement[] = [
      { type: "TRANSFER", lines: [{ variantId: "v1", quantity: d("5") }] },
    ];
    const result = classifyLedgerMovements(movements);
    assert.equal(result.unprovableVariantIds.has("v1"), true);
    assert.equal(result.provableNetByVariant.has("v1"), false);
  });

  it("keeps variants independent - one variant's ADJUSTMENT does not taint another's provable sum", () => {
    const movements: LedgerMovement[] = [
      { type: "ADJUSTMENT", lines: [{ variantId: "v1", quantity: d("2") }] },
      { type: "SALE", lines: [{ variantId: "v2", quantity: d("3") }] },
    ];
    const result = classifyLedgerMovements(movements);
    assert.equal(result.unprovableVariantIds.has("v1"), true);
    assert.equal(result.unprovableVariantIds.has("v2"), false);
    assert.equal(result.provableNetByVariant.get("v2")?.toString(), "-3");
  });

  it("returns an empty classification for no movements", () => {
    const result = classifyLedgerMovements([]);
    assert.equal(result.provableNetByVariant.size, 0);
    assert.equal(result.unprovableVariantIds.size, 0);
  });
});

describe("sumOrderBookedOut", () => {
  it("counts SALE positively (taken out) and RETURN_IN negatively (given back)", () => {
    const movements: LedgerMovement[] = [
      { type: "SALE", lines: [{ variantId: "v1", quantity: d("3") }] },
      { type: "RETURN_IN", lines: [{ variantId: "v1", quantity: d("1") }] },
    ];
    const result = sumOrderBookedOut(movements);
    assert.equal(result.get("v1")?.toString(), "2");
  });

  it("aggregates the same variant across multiple movements/lines", () => {
    const movements: LedgerMovement[] = [
      { type: "SALE", lines: [{ variantId: "v1", quantity: d("1") }] },
      { type: "SALE", lines: [{ variantId: "v1", quantity: d("1") }] },
    ];
    const result = sumOrderBookedOut(movements);
    assert.equal(result.get("v1")?.toString(), "2");
  });

  it("ignores a non SALE/RETURN_IN movement type defensively rather than throwing", () => {
    const movements: LedgerMovement[] = [
      { type: "ADJUSTMENT", lines: [{ variantId: "v1", quantity: d("99") }] },
    ];
    const result = sumOrderBookedOut(movements);
    assert.equal(result.has("v1"), false);
  });
});
