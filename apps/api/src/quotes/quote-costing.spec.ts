import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";

import {
  computeCosting,
  listPriceFromDecision,
  type CostingInput,
  type CostingListPrice,
} from "./quote-costing.js";

const d = (v: string) => new Prisma.Decimal(v);
const price = (unitNet: string): CostingListPrice => ({
  unitNet: d(unitNet),
  reason: null,
  sale: false,
});
const item = (
  over: Partial<CostingInput["items"][number]>,
): CostingInput["items"][number] => ({
  id: "i1",
  name: "Tétel",
  source: "STANDALONE",
  variantId: null,
  quantity: d("1"),
  unitNetPrice: d("100"),
  isOptional: false,
  ...over,
});
const bom = (
  over: Partial<CostingInput["bomItems"][number]>,
): CostingInput["bomItems"][number] => ({
  quoteItemId: "i1",
  kind: "CUSTOM",
  variantId: null,
  customName: "Egyedi",
  quantity: d("1"),
  unitCost: d("10"),
  costCurrency: "HUF",
  costSource: "MANUAL",
  sourcePurchaseInvoiceLineId: null,
  label: "Egyedi",
  ...over,
});
const run = (over: Partial<CostingInput>) =>
  computeCosting({
    versionId: "v1",
    currency: "HUF",
    items: [],
    bomItems: [],
    listPrices: new Map(),
    ...over,
  });

describe("quote costing: suggested price (acrobot 27773)", () => {
  it("PRODUCT: the variant's list net, named LIST_PRICE", () => {
    const line = run({
      items: [item({ source: "PRODUCT", variantId: "v" })],
      bomItems: [bom({ kind: "PRODUCT", variantId: "v", customName: null })],
      listPrices: new Map([["v", price("787.4016")]]),
    }).lines[0]!;
    assert.equal(line.suggestedPriceSource, "LIST_PRICE");
    assert.equal(line.suggestedUnitPrice, "787.4016");
    assert.equal(line.suggestedPriceComplete, true);
  });

  it("BOM: PRODUCT rows at selling price plus CUSTOM/SERVICE at cost, per customer unit", () => {
    const line = run({
      items: [item({ source: "BOM", quantity: d("2") })],
      bomItems: [
        bom({
          kind: "PRODUCT",
          variantId: "v",
          customName: null,
          quantity: d("4"),
          unitCost: d("50"),
        }),
        bom({
          kind: "SERVICE",
          customName: "Munka",
          quantity: d("3"),
          unitCost: d("1000"),
        }),
      ],
      listPrices: new Map([["v", price("100")]]),
    }).lines[0]!;
    // (4 * 100 selling + 3 * 1000 cost) / 2 customer units
    assert.equal(line.suggestedPriceSource, "BOM_SUM");
    assert.equal(line.suggestedUnitPrice, "1700.0000");
    assert.equal(line.suggestedPriceComplete, true);
  });

  it("BOM: a row without data marks the suggestion incomplete", () => {
    const line = run({
      items: [item({ source: "BOM" })],
      bomItems: [
        bom({ kind: "PRODUCT", variantId: "v", customName: null }),
        bom({ customName: "Munka", unitCost: d("5") }),
      ],
      listPrices: new Map([
        ["v", { unitNet: null, reason: "own-price-missing", sale: false }],
      ]),
    }).lines[0]!;
    assert.equal(line.suggestedUnitPrice, "5.0000");
    assert.equal(line.suggestedPriceComplete, false);
    assert.ok(line.warnings.some((w) => w.includes("own-price-missing")));
  });

  it("STANDALONE: no suggestion and no source", () => {
    const line = run({ items: [item({})] }).lines[0]!;
    assert.equal(line.suggestedUnitPrice, null);
    assert.equal(line.suggestedPriceSource, null);
  });
});

describe("quote costing: the PRODUCT item's own BOM row", () => {
  const product = (bomQuantity: string, bomVariant = "v") =>
    run({
      items: [item({ source: "PRODUCT", variantId: "v", quantity: d("10") })],
      bomItems: [
        bom({
          kind: "PRODUCT",
          variantId: bomVariant,
          customName: null,
          quantity: d(bomQuantity),
        }),
      ],
      listPrices: new Map([["v", price("100")]]),
    }).lines[0]!.warnings.filter((w) => w.includes("saját anyaglista-sora"));

  it("is quiet when the row matches the item", () => {
    assert.deepEqual(product("10"), []);
  });
  it("warns when the quantity or the variant drifted", () => {
    assert.equal(product("2").length, 1);
    assert.equal(product("10", "other").length, 1);
  });
});

describe("quote costing: margin", () => {
  it("line net minus the BOM cost; the BOM quantity is for the whole line", () => {
    const line = run({
      items: [
        item({ source: "BOM", quantity: d("2"), unitNetPrice: d("100") }),
      ],
      bomItems: [bom({ quantity: d("3"), unitCost: d("40") })],
    }).lines[0]!;
    // 200 net, 3 * 40 = 120 cost (not 2 * 3 * 40)
    assert.equal(line.bomCost, "120.0000");
    assert.equal(line.marginAmount, "80.0000");
    assert.equal(line.marginPercent, "40.00");
  });

  it("an incomplete cost gives NO margin (it would be an upper bound)", () => {
    const result = run({
      items: [item({ source: "BOM" })],
      bomItems: [
        bom({}),
        bom({ customName: "Hiányzó", label: "Hiányzó", unitCost: null }),
      ],
    });
    const line = result.lines[0]!;
    assert.equal(line.bomCost, "10.0000");
    assert.equal(line.bomCostComplete, false);
    assert.equal(line.marginAmount, null);
    assert.equal(result.totals.marginAmount, null);
    assert.ok(line.warnings.some((w) => w.includes("Hiányzó")));
  });

  it("totals count the offered lines only, not the optional ones", () => {
    const result = run({
      items: [
        item({ id: "a", source: "BOM", unitNetPrice: d("100") }),
        item({
          id: "b",
          source: "BOM",
          unitNetPrice: d("900"),
          isOptional: true,
        }),
      ],
      bomItems: [
        bom({ quoteItemId: "a", unitCost: d("60") }),
        bom({ quoteItemId: "b", unitCost: d("1") }),
      ],
    });
    assert.equal(result.totals.net, "100.0000");
    assert.equal(result.totals.cost, "60.0000");
    assert.equal(result.totals.marginAmount, "40.0000");
    assert.equal(result.totals.marginPercent, "40.00");
  });

  it("a non-HUF version: no margin and no suggestion, with a warning", () => {
    const result = run({
      currency: "EUR",
      items: [item({ source: "PRODUCT", variantId: "v" })],
      bomItems: [bom({ kind: "PRODUCT", variantId: "v", customName: null })],
      listPrices: new Map([["v", price("100")]]),
    });
    assert.equal(result.lines[0]!.marginAmount, null);
    assert.equal(result.lines[0]!.suggestedUnitPrice, null);
    assert.equal(result.totals.marginAmount, null);
    assert.equal(result.warnings.length, 1);
  });
});

describe("quote costing: list price from the price-source decision", () => {
  const own = (gross: string | null, currency: string | null = "HUF") =>
    ({
      ok: true,
      source: "own",
      surcharge: null,
      price: {
        sellingGrossPrice: gross === null ? null : d(gross),
        sellingPriceCurrency: currency,
      },
    }) as const;

  it("nets the gross with the variant's VAT rate", () => {
    assert.equal(
      listPriceFromDecision(own("1270"), d("27")).unitNet?.toString(),
      "1000",
    );
  });
  it("a missing VAT rate, a foreign currency or a refusal is a named reason, never a number", () => {
    assert.deepEqual(listPriceFromDecision(own("1270"), null), {
      unitNet: null,
      reason: "vat-rate-missing",
      sale: false,
    });
    assert.equal(
      listPriceFromDecision(own("10", "EUR"), d("27")).reason,
      "currency-EUR",
    );
    assert.equal(
      listPriceFromDecision(
        { ok: false, reason: "mirror-row-missing", details: "" },
        d("27"),
      ).reason,
      "mirror-row-missing",
    );
  });
  it("a running sale is flagged", () => {
    const sale = listPriceFromDecision(
      { ...own("127"), source: "mirror-sale" },
      d("27"),
    );
    assert.equal(sale.sale, true);
  });
});
