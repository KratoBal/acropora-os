import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WebshopOrderTaxCheck } from "@acropora/types";

import type { MedusaOrderDetailRow } from "../../integrations/medusa/medusa-admin.client.js";
import {
  huBaseNumberOk,
  huTaxNumberOf,
  navNameMatches,
  orderCompanyName,
  orderTaxNumberShape,
  taxCheckRefusal,
} from "./webshop-order-tax-check.rules.js";

/** A generated base number with a valid check digit (no real company's tax number in the tests). */
const BASE = (() => {
  for (let n = 10000000; n < 10000100; n += 1)
    if (huBaseNumberOk(String(n))) return String(n);
  throw new Error("no valid base number in range");
})();
const BAD_BASE = `${BASE.slice(0, 7)}${(Number(BASE[7]) + 1) % 10}`;

const order = (
  billing: { company?: string; tax_id?: unknown } | null,
  shipping: { company?: string; tax_id?: unknown } | null = null,
) =>
  ({
    billing_address: billing && {
      company: billing.company ?? null,
      metadata:
        billing.tax_id === undefined ? null : { tax_id: billing.tax_id },
    },
    shipping_address: shipping && {
      company: shipping.company ?? null,
      metadata:
        shipping.tax_id === undefined ? null : { tax_id: shipping.tax_id },
    },
  }) as unknown as MedusaOrderDetailRow;

describe("huBaseNumberOk", () => {
  it("accepts a base number whose last digit is the check digit, and nothing else", () => {
    assert.equal(huBaseNumberOk(BASE), true);
    assert.equal(huBaseNumberOk(BAD_BASE), false);
    assert.equal(huBaseNumberOk("1234567"), false);
    assert.equal(huBaseNumberOk("1234567a"), false);
  });
});

describe("orderTaxNumberShape", () => {
  it("no number: NONE", () => {
    assert.deepEqual(orderTaxNumberShape(order({})), { kind: "NONE" });
    assert.deepEqual(orderTaxNumberShape(order({ tax_id: "  " })), {
      kind: "NONE",
    });
    assert.deepEqual(orderTaxNumberShape(order(null, null)), { kind: "NONE" });
  });

  it("a Hungarian number, with or without hyphens and spaces, is unified", () => {
    for (const raw of [`${BASE}-2-41`, `${BASE}241`, ` ${BASE} 2 41 `])
      assert.deepEqual(orderTaxNumberShape(order({ tax_id: raw })), {
        kind: "HU",
        taxNumber: `${BASE}-2-41`,
      });
  });

  it("11 digits with a wrong check digit, or a VAT code outside 1-5, is MALFORMED", () => {
    for (const raw of [`${BAD_BASE}-2-41`, `${BASE}-0-41`, `${BASE}-6-41`])
      assert.equal(
        orderTaxNumberShape(order({ tax_id: raw })).kind,
        "MALFORMED",
        raw,
      );
  });

  it("a Community number is EU: not for NAV, and not a reason to stop", () => {
    for (const raw of ["DE123456789", "ATU12345678", "de 123 456 789"])
      assert.equal(orderTaxNumberShape(order({ tax_id: raw })).kind, "EU", raw);
  });

  it("anything else is MALFORMED: the store API is public, tax_id can be any text", () => {
    for (const raw of [
      "abc",
      "12345",
      "1234567890123",
      "<script>",
      "DROP TABLE;",
    ])
      assert.deepEqual(orderTaxNumberShape(order({ tax_id: raw })), {
        kind: "MALFORMED",
        raw,
      });
  });

  it("the billing address is read first, the shipping address only when the order has no billing address (the invoice rule's own reading)", () => {
    assert.equal(
      orderTaxNumberShape(
        order({ tax_id: `${BASE}-2-41` }, { tax_id: "DE123456789" }),
      ).kind,
      "HU",
    );
    assert.equal(
      orderTaxNumberShape(order(null, { tax_id: `${BASE}-2-41` })).kind,
      "HU",
    );
  });

  it("a number that is not a string is no number", () => {
    assert.deepEqual(orderTaxNumberShape(order({ tax_id: 12345678241 })), {
      kind: "NONE",
    });
  });

  it("huTaxNumberOf is the Hungarian one only", () => {
    assert.equal(
      huTaxNumberOf(order({ tax_id: `${BASE}241` })),
      `${BASE}-2-41`,
    );
    assert.equal(huTaxNumberOf(order({ tax_id: "DE123456789" })), null);
    assert.equal(huTaxNumberOf(order({ tax_id: `${BAD_BASE}-2-41` })), null);
  });
});

describe("orderCompanyName", () => {
  it("the billing company, else the shipping one, else null", () => {
    assert.equal(
      orderCompanyName(order({ company: " Minta Kft. " }, { company: "Más" })),
      "Minta Kft.",
    );
    assert.equal(
      orderCompanyName(order({}, { company: "Szállítási Bt." })),
      "Szállítási Bt.",
    );
    assert.equal(orderCompanyName(order({})), null);
  });
});

describe("navNameMatches", () => {
  it("the same name matches whatever the legal form and the punctuation", () => {
    assert.equal(
      navNameMatches("Minta Kft.", "MINTA KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG"),
      true,
    );
    assert.equal(
      navNameMatches("Minta Akvarisztika Kft", "Minta Akvarisztika"),
      true,
    );
    assert.equal(
      navNameMatches("minta-akvarisztika", "Minta Akvarisztika Zrt."),
      true,
    );
  });

  it("an abbreviation inside the NAV name matches (a signal, not a gate)", () => {
    assert.equal(
      navNameMatches("Minta", "Minta Akvarisztikai Szolgáltató Kft."),
      true,
    );
  });

  it("another company's name does not", () => {
    assert.equal(navNameMatches("Minta Kft.", "Teljesen Más Zrt."), false);
  });

  it("not comparable: null", () => {
    assert.equal(navNameMatches(null, "Minta Kft."), null);
    assert.equal(navNameMatches("Minta Kft.", null), null);
    assert.equal(navNameMatches("Kft.", "Zrt."), null);
  });
});

describe("taxCheckRefusal", () => {
  const check = (
    state: WebshopOrderTaxCheck["state"],
  ): WebshopOrderTaxCheck => ({
    state,
    taxNumber: "12345678-2-41",
    navName: null,
    nameMatches: null,
  });

  it("stops for the NAV's 'no such number' and for a malformed one, naming the number", () => {
    assert.match(
      taxCheckRefusal(check("INVALID")) ?? "",
      /A NAV szerint nincs ilyen adószám: 12345678-2-41/,
    );
    assert.match(
      taxCheckRefusal(check("MALFORMED")) ?? "",
      /nem érvényes alakú: 12345678-2-41/,
    );
  });

  it("does not stop for no number, a Community number, a valid one, or a NAV that did not answer", () => {
    for (const state of ["NONE", "VALID", "UNAVAILABLE"] as const)
      assert.equal(taxCheckRefusal(check(state)), null, state);
  });
});
