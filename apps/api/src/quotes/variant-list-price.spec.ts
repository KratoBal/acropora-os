import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { loadVariantListPrices } from "./variant-list-price.js";

/**
 * A VÁLTOZAT MAI NETTÓ ELADÁSI ÁRA (a haszon-számítás ezt olvassa). A `vatRate` a
 * változaton SZÁZALÉK: 27, nem 0,27 (barracuda #1832, az árlista 4. szeletének
 * elfogadási feltétele). MI PIROSÍT: ha a nettó nem bruttó / (1 + vatRate / 100);
 * ha egy tört alakú áfakulcs (0,27) észrevétlenül átmenne; ha hiányzó áfakulcs vagy
 * ár nullát adna a megnevezett ok helyett.
 */
function database(
  variant: Partial<{
    vatRate: string | null;
    gross: string | null;
    currency: string | null;
  }>,
) {
  return {
    productVariant: {
      findMany: async () => [
        {
          id: "v1",
          productId: "p1",
          vatRate:
            variant.vatRate === undefined || variant.vatRate === null
              ? null
              : new Prisma.Decimal(variant.vatRate),
          sellingGrossPrice:
            variant.gross === undefined || variant.gross === null
              ? null
              : new Prisma.Decimal(variant.gross),
          sellingPriceCurrency:
            variant.currency === undefined ? "HUF" : variant.currency,
          unasVariantExtraGrossPrice: null,
          product: { catalogAuthority: "ACROPORA" },
        },
      ],
    },
    unasProductSnapshot: { findMany: async () => [] },
  } as never;
}

describe("loadVariantListPrices", () => {
  it("27 % on 12 700 Ft gross is 10 000 Ft net (the rate is a percent)", async () => {
    const price = (
      await loadVariantListPrices(database({ vatRate: "27", gross: "12700" }), [
        "v1",
      ])
    ).get("v1")!;
    assert.equal(price.unitNet?.toFixed(2), "10000.00");
    assert.equal(price.reason, null);
  });

  it("a zero rate leaves the gross as the net, and 5 % on 10 500 Ft is 10 000 Ft", async () => {
    assert.equal(
      (
        await loadVariantListPrices(
          database({ vatRate: "0", gross: "12700" }),
          ["v1"],
        )
      )
        .get("v1")!
        .unitNet?.toFixed(2),
      "12700.00",
    );
    assert.equal(
      (
        await loadVariantListPrices(
          database({ vatRate: "5", gross: "10500" }),
          ["v1"],
        )
      )
        .get("v1")!
        .unitNet?.toFixed(2),
      "10000.00",
    );
  });

  it("a fraction (0.27) is NOT read as 27 %: it would net 12 700 to 12 665.80, which is why the field is documented as a percent", async () => {
    const price = (
      await loadVariantListPrices(
        database({ vatRate: "0.27", gross: "12700" }),
        ["v1"],
      )
    ).get("v1")!;
    assert.equal(price.unitNet?.toFixed(2), "12665.80");
  });

  it("names the reason instead of returning zero: no VAT rate, no price, a foreign selling currency", async () => {
    const reasons = [
      (
        await loadVariantListPrices(
          database({ vatRate: null, gross: "12700" }),
          ["v1"],
        )
      ).get("v1")!.reason,
      (
        await loadVariantListPrices(database({ vatRate: "27", gross: null }), [
          "v1",
        ])
      ).get("v1")!.reason,
      (
        await loadVariantListPrices(
          database({ vatRate: "27", gross: "100", currency: "EUR" }),
          ["v1"],
        )
      ).get("v1")!.reason,
    ];
    assert.deepEqual(reasons, [
      "vat-rate-missing",
      "own-price-missing",
      "currency-EUR",
    ]);
  });

  it("returns nothing for an empty list of variants", async () => {
    assert.equal((await loadVariantListPrices(database({}), [])).size, 0);
  });
});
