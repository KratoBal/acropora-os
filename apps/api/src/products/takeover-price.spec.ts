import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { takeoverPriceLog, takeoverPriceSteps } from "./takeover-price.js";

const variant = (
  overrides: Partial<Parameters<typeof takeoverPriceSteps>[0][number]> = {},
) => ({
  id: "variant-1",
  sku: "RS-1",
  sellingGrossPrice: null,
  unasVariantExtraGrossPrice: null,
  ...overrides,
});

describe("takeoverPriceSteps", () => {
  it("copies the list price plus the surcharge in forint", () => {
    const [step] = takeoverPriceSteps(
      [variant({ unasVariantExtraGrossPrice: new Prisma.Decimal("250.5") })],
      { grossPrice: new Prisma.Decimal("1000"), currency: null },
    );

    assert.equal(step?.kind, "copy");
    assert.equal(
      step?.kind === "copy" && step.sellingGrossPrice.toFixed(4),
      "1250.5000",
    );
    assert.equal(step?.kind === "copy" && step.sellingPriceCurrency, "HUF");
  });

  it("keeps a currency the mirror does name", () => {
    const [step] = takeoverPriceSteps([variant()], {
      grossPrice: new Prisma.Decimal("10"),
      currency: "EUR",
    });

    assert.equal(step?.kind === "copy" && step.sellingPriceCurrency, "EUR");
  });

  /**
   * The mirror row has no sale field in its select on purpose: a sale price
   * copied into the own field would become a sale that never ends.
   */
  it("takes only the list price, never a sale", () => {
    const mirror = {
      grossPrice: new Prisma.Decimal("1000"),
      currency: null,
      saleGrossPrice: new Prisma.Decimal("800"),
    };
    const [step] = takeoverPriceSteps([variant()], mirror);

    assert.equal(
      step?.kind === "copy" && step.sellingGrossPrice.toFixed(0),
      "1000",
    );
  });

  it("names the reason for every variant it does not price", () => {
    const steps = takeoverPriceSteps(
      [variant({ sellingGrossPrice: new Prisma.Decimal("5") })],
      { grossPrice: new Prisma.Decimal("10"), currency: null },
    );
    assert.deepEqual(steps, [
      {
        kind: "skip",
        variantId: "variant-1",
        sku: "RS-1",
        reason: "own-price-set",
      },
    ]);

    assert.deepEqual(
      takeoverPriceSteps([variant()], null).map(
        (step) => step.kind === "skip" && step.reason,
      ),
      ["mirror-row-missing"],
    );
    assert.deepEqual(
      takeoverPriceSteps([variant()], {
        grossPrice: null,
        currency: null,
      }).map((step) => step.kind === "skip" && step.reason),
      ["mirror-price-missing"],
    );
  });
});

describe("takeoverPriceLog", () => {
  it("records the source, the copied prices and the skipped variants", () => {
    const log = takeoverPriceLog(
      takeoverPriceSteps(
        [
          variant(),
          variant({
            id: "variant-2",
            sku: "RS-2",
            sellingGrossPrice: new Prisma.Decimal("1"),
          }),
        ],
        { grossPrice: new Prisma.Decimal("1000"), currency: null },
      ),
    );

    assert.deepEqual(log, {
      source: "unas-mirror-list-price",
      copied: [
        {
          variantId: "variant-1",
          sku: "RS-1",
          sellingGrossPrice: "1000.0000",
          sellingPriceCurrency: "HUF",
        },
      ],
      skipped: [
        { variantId: "variant-2", sku: "RS-2", reason: "own-price-set" },
      ],
    });
  });
});
