import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { billingProductPrice } from "./billing-product-price.js";
import type { ProductDetail } from "./product-catalog.js";

// THE PRICE A PICKED PRODUCT BRINGS INTO A BILLING LINE (Balázs on stage,
// 2026-09-30; the rule agreed in acrobot 25248). What must fail: a frozen
// mirror price used for a product we own; the sale price instead of the list
// price; a price in another currency; a zero where there is no price; a VAT
// rate made up for a gross price.
function product(overrides: {
  catalogAuthority?: ProductDetail["catalogAuthority"];
  mirror?: Partial<NonNullable<ProductDetail["unasMirror"]>> | null;
  variant?: Partial<ProductDetail["variants"][number]>;
}): ProductDetail {
  const variant = {
    id: "v-1",
    sku: "SKU-1",
    name: null,
    unit: "db",
    isActive: true,
    vatRate: "27.00",
    sellingGrossPrice: null,
    sellingPriceCurrency: null,
    ...overrides.variant,
  };
  return {
    id: "p-1",
    name: "Tengeri só",
    primarySku: "SKU-1",
    catalogAuthority:
      overrides.catalogAuthority === undefined
        ? "UNAS"
        : overrides.catalogAuthority,
    variants: [variant],
    unasMirror:
      overrides.mirror === null
        ? null
        : {
            currency: "HUF",
            netPrice: "1000.0000",
            grossPrice: "1270.0000",
            vatRate: "27.00",
            saleNetPrice: "800.0000",
            saleGrossPrice: "1016.0000",
            ...overrides.mirror,
          },
  } as unknown as ProductDetail;
}

describe("billingProductPrice", () => {
  it("UNAS owner: the mirror's net list price and the variant's rate", () => {
    assert.deepEqual(billingProductPrice(product({}), "HUF"), {
      kind: "NET",
      unitNet: "1000",
      vatRatePercent: "27",
      source: "UNAS_MIRROR",
    });
  });

  it("UNAS owner without a variant rate: the mirror's rate", () => {
    const result = billingProductPrice(
      product({ variant: { vatRate: null }, mirror: { vatRate: "5.00" } }),
      "HUF",
    );
    assert.equal(result.kind === "NET" && result.vatRatePercent, "5");
  });

  it("ACROPORA owner: our own gross price, never the frozen mirror", () => {
    assert.deepEqual(
      billingProductPrice(
        product({
          catalogAuthority: "ACROPORA",
          variant: {
            sellingGrossPrice: "1524.0000",
            sellingPriceCurrency: "HUF",
          },
        }),
        "HUF",
      ),
      {
        kind: "GROSS",
        unitGross: "1524",
        vatRatePercent: "27",
        source: "OWN",
      },
    );
  });

  it("the primary SKU's variant, not simply the first one", () => {
    const detail = product({
      catalogAuthority: "ACROPORA",
      variant: { sellingGrossPrice: "999", sellingPriceCurrency: "HUF" },
    });
    detail.variants = [
      { ...detail.variants[0]!, id: "v-0", sku: "SKU-0" },
      {
        ...detail.variants[0]!,
        sellingGrossPrice: "1524",
        sellingPriceCurrency: "HUF",
      },
    ];
    detail.variants[0]!.sellingGrossPrice = "999";
    const result = billingProductPrice(detail, "HUF");
    assert.equal(result.kind === "GROSS" && result.unitGross, "1524");
  });

  it("no price is no price: empty with a reason, never zero", () => {
    const cases: [ProductDetail, RegExp][] = [
      [product({ mirror: { netPrice: null } }), /nincs nettó ára/],
      [product({ mirror: null }), /nincs nettó ára/],
      [
        product({ catalogAuthority: "ACROPORA" }),
        /még nincs saját eladási ára/,
      ],
      [
        product({
          catalogAuthority: "ACROPORA",
          variant: {
            vatRate: null,
            sellingGrossPrice: "1270",
            sellingPriceCurrency: "HUF",
          },
          mirror: { vatRate: null },
        }),
        /nincs ÁFA-kulcsa/,
      ],
      [product({ catalogAuthority: null }), /gazdája nincs kimondva/],
    ];
    for (const [detail, reason] of cases) {
      const result = billingProductPrice(detail, "HUF");
      assert.equal(result.kind, "NONE");
      assert.match(result.kind === "NONE" ? result.reason : "", reason);
    }
  });

  it("a price in another currency is not a price for this document", () => {
    const result = billingProductPrice(product({}), "EUR");
    assert.equal(result.kind, "NONE");
    assert.match(result.kind === "NONE" ? result.reason : "", /HUF.*EUR/);
  });
});
