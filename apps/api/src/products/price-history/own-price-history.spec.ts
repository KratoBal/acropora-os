import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  recordOwnPrice,
  type OwnPriceHistoryTransaction,
} from "./own-price-history.js";

/*
  WHAT TURNS THIS RED (card edd0c25b, T4.1-D2). No row for a variant's first own price (the
  30-day window would have no beginning); a row for an UNCHANGED price (the history becomes
  as noisy as the number of saves); no row for a CHANGED price or currency; a row that is not
  `OWN` or has no `variantId` (it would pass for a mirror row); the last row looked up by
  product instead of by variant (two variants of one product would overwrite each other's
  baseline).
*/

const D = (v: string) => new Prisma.Decimal(v);
const AT = new Date("2026-11-04T08:00:00Z");

function fake(last: unknown) {
  const calls: { op: string; args: unknown }[] = [];
  const tx = {
    productPriceHistory: {
      findFirst: async (args: unknown) => {
        calls.push({ op: "find", args });
        return last;
      },
      create: async (args: unknown) => {
        calls.push({ op: "create", args });
        return {};
      },
    },
  } as unknown as OwnPriceHistoryTransaction;
  return { tx, calls };
}

const input = (over: Partial<Parameters<typeof recordOwnPrice>[1]> = {}) => ({
  productId: "p1",
  variantId: "v1",
  currency: "HUF",
  grossPrice: D("14490"),
  saleGrossPrice: null,
  observedAt: AT,
  ...over,
});

const row = (gross: string, currency = "HUF") => ({
  currency,
  netPrice: null,
  grossPrice: D(gross),
  saleNetPrice: null,
  saleGrossPrice: null,
});

describe("recordOwnPrice", () => {
  it("writes the first own price of a variant as an OWN row with its variantId", async () => {
    const { tx, calls } = fake(null);
    assert.equal(await recordOwnPrice(tx, input()), "written");
    const create = calls.find((c) => c.op === "create")!.args as {
      data: Record<string, unknown>;
    };
    assert.equal(create.data.source, "OWN");
    assert.equal(create.data.variantId, "v1");
    assert.equal(create.data.productId, "p1");
    assert.equal(create.data.currency, "HUF");
    assert.equal(String(create.data.grossPrice), "14490");
    assert.equal(create.data.netPrice, null);
    assert.equal(create.data.saleGrossPrice, null);
    assert.equal(create.data.observedAt, AT);
  });

  it("looks the last row up by VARIANT, newest first", async () => {
    const { tx, calls } = fake(null);
    await recordOwnPrice(tx, input());
    const find = calls.find((c) => c.op === "find")!.args as {
      where: unknown;
      orderBy: unknown;
    };
    assert.deepEqual(find.where, { variantId: "v1" });
    assert.deepEqual(find.orderBy, [
      { observedAt: "desc" },
      { createdAt: "desc" },
    ]);
  });

  it("writes nothing when the price is the same, however the decimal is spelled", async () => {
    for (const same of ["14490", "14490.0000", "14490.00"]) {
      const { tx, calls } = fake(row(same));
      assert.equal(await recordOwnPrice(tx, input()), "unchanged", same);
      assert.equal(calls.filter((c) => c.op === "create").length, 0, same);
    }
  });

  it("writes a row when the price changed, or only the currency did", async () => {
    const changed = fake(row("12990"));
    assert.equal(await recordOwnPrice(changed.tx, input()), "written");
    assert.equal(changed.calls.filter((c) => c.op === "create").length, 1);
    const currency = fake(row("14490", "EUR"));
    assert.equal(await recordOwnPrice(currency.tx, input()), "written");
  });
});
