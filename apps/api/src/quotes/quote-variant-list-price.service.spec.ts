import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { QuoteCostingService } from "./quote-costing.service.js";

/**
 * A VÁLTOZAT MAI ELADÁSI ÁRA A TÉTEL KITÖLTÉSÉHEZ (Luca, 2026-11-13). MI PIROSÍT: ha a nettó nem a bruttó és az
 * áfakulcs hányadosa; ha egy hiányzó ár nullaként jönne ki a megnevezett ok helyett; ha nem forintos ajánlatnál
 * forintos szám menne ki; ha egy másik ajánlat verziójának azonosítójával is megjön az ár.
 */
function service(options: {
  versionCurrency?: string | null;
  gross?: string | null;
  vatRate?: string | null;
}) {
  const instance = new QuoteCostingService();
  (instance as unknown as { database: unknown }).database = {
    quoteVersion: {
      findFirst: async () =>
        options.versionCurrency === null
          ? null
          : { currency: options.versionCurrency ?? "HUF" },
    },
    productVariant: {
      findMany: async () => [
        {
          id: "v1",
          productId: "p1",
          vatRate:
            options.vatRate === undefined || options.vatRate === null
              ? options.vatRate === null
                ? null
                : new Prisma.Decimal("27")
              : new Prisma.Decimal(options.vatRate),
          sellingGrossPrice:
            options.gross === undefined || options.gross === null
              ? null
              : new Prisma.Decimal(options.gross),
          sellingPriceCurrency: "HUF",
          sellingSaleGrossPrice: null,
          sellingSaleStartsAt: null,
          sellingSaleEndsAt: null,
          unasVariantExtraGrossPrice: null,
          product: { catalogAuthority: "ACROPORA" },
        },
      ],
    },
    unasProductSnapshot: { findMany: async () => [] },
  };
  return instance;
}

describe("QuoteCostingService.variantListPrice", () => {
  it("12 700 Ft bruttó 27 % mellett 10 000 Ft nettó, négy tizedessel", async () => {
    const answer = await service({ gross: "12700" }).variantListPrice(
      "q1",
      "ver1",
      "v1",
    );
    assert.deepEqual(answer, {
      variantId: "v1",
      unitNetPrice: "10000.0000",
      sale: false,
      reason: null,
    });
  });

  it("ár nélküli változatnál null a nettó és megnevezett az ok, nem nulla", async () => {
    const answer = await service({ gross: null }).variantListPrice(
      "q1",
      "ver1",
      "v1",
    );
    assert.equal(answer.unitNetPrice, null);
    assert.ok(answer.reason);
  });

  it("áfakulcs nélküli változatnál megnevezett ok, nem találgatott nettó", async () => {
    const answer = await service({
      gross: "12700",
      vatRate: null,
    }).variantListPrice("q1", "ver1", "v1");
    assert.equal(answer.unitNetPrice, null);
    assert.equal(answer.reason, "vat-rate-missing");
  });

  it("nem forintos ajánlatnál nem ad számot", async () => {
    const answer = await service({
      versionCurrency: "EUR",
      gross: "12700",
    }).variantListPrice("q1", "ver1", "v1");
    assert.equal(answer.unitNetPrice, null);
    assert.equal(answer.reason, "quote-currency-EUR");
  });

  it("másik ajánlathoz tartozó vagy hiányzó verzióra 404", async () => {
    await assert.rejects(
      () =>
        service({ versionCurrency: null }).variantListPrice(
          "q1",
          "other",
          "v1",
        ),
      /nem található/,
    );
  });
});
