import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import type { LowestPrice } from "../../products/price-history/lowest-price.js";
import type {
  PriceData,
  StockData,
  UnknownSection,
} from "./product-data.types.js";
import {
  buildProductData,
  runningSaleVariantIds,
  type ProductRow,
  type VariantRow,
} from "./product-data.view.js";

/*
  WHAT TURNS THIS RED (task t54-friss-termekadat, spec 1 to 4). A missing stock row, a negative sum or an untracked
  variant that comes out as a number or as "nincs"; a zero before any stocktake that is not marked "nem leltározott";
  a standing UNAS sale that invents an end date; a taken-over product whose frozen mirror sale is shown as a sale; a
  price the shop would not show; an unknown Omnibus reference that becomes a number; an empty arrivals list that does
  not say it is not exhaustive; any purchase price, margin or supplier leaking into the answer.
*/

const D = (v: string) => new Prisma.Decimal(v);
const NOW = new Date("2026-11-12T08:00:00Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);

function variant(patch: Partial<VariantRow> = {}): VariantRow {
  return {
    id: "v1",
    sku: "SKU-1",
    name: null,
    isActive: true,
    sellingGrossPrice: null,
    sellingPriceCurrency: null,
    sellingSaleGrossPrice: null,
    sellingSaleStartsAt: null,
    sellingSaleEndsAt: null,
    unasVariantExtraGrossPrice: null,
    extension: null,
    stockItems: [{ onHand: D("5"), reserved: D("1"), updatedAt: at(-2) }],
    countedLines: [],
    purchaseLines: [],
    ...patch,
  };
}

function product(patch: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "p1",
    name: "Termék",
    isActive: true,
    archivedAt: null,
    type: "PHYSICAL",
    catalogAuthority: "UNAS",
    brand: null,
    categories: [],
    channelListings: [],
    unasSnapshot: {
      grossPrice: D("10000"),
      currency: null,
      saleGrossPrice: null,
      saleStartsAt: null,
      saleEndsAt: null,
      productUrl: null,
    },
    shippingProfile: null,
    priceChanges: [],
    livestockArrivals: [],
    variants: [variant()],
    ...patch,
  };
}

const ctx = (omnibus = new Map<string, LowestPrice | null>()) => ({
  now: NOW,
  omnibus,
});
const price = (row: ProductRow, c = ctx()) => {
  const p = buildProductData(row, c).variants[0]!.price;
  assert.equal(p.status, "ismert", JSON.stringify(p));
  return p as PriceData;
};
const stock = (v: Partial<VariantRow>) =>
  buildProductData(product({ variants: [variant(v)] }), ctx()).variants[0]!
    .stock as StockData;

describe("price", () => {
  it("UNAS-owned: the mirror price plus the variant surcharge, HUF by default, no sale", () => {
    const p = price(
      product({
        variants: [variant({ unasVariantExtraGrossPrice: D("500") })],
      }),
    );
    assert.equal(p.listPrice, "10500");
    assert.equal(p.currentPrice, "10500");
    assert.equal(p.sale, null);
    assert.equal(p.priceSource, "UNAS tükör");
    assert.deepEqual(p.omnibus, { status: "nincs futó akció" });
  });

  it("a running mirror sale: the sale price is current, the list price stays, a standing sale is open-ended", () => {
    const row = product({
      unasSnapshot: {
        grossPrice: D("10000"),
        currency: null,
        saleGrossPrice: D("8000"),
        saleStartsAt: null,
        saleEndsAt: null,
        productUrl: null,
      },
    });
    const p = price(row);
    assert.equal(p.currentPrice, "8000");
    assert.equal(p.listPrice, "10000");
    assert.deepEqual(p.sale, {
      state: "fut",
      price: "8000",
      startsAt: "ismeretlen",
      endsAt: "ismeretlen",
      openEnded: true,
    });
  });

  it("a mirror sale that ended is NOT reported, a mirror sale that starts later is `tervezett`", () => {
    const base = {
      grossPrice: D("10000"),
      currency: null,
      saleGrossPrice: D("8000"),
      productUrl: null,
    };
    const ended = price(
      product({
        unasSnapshot: { ...base, saleStartsAt: at(-48), saleEndsAt: at(-1) },
      }),
    );
    assert.equal(ended.sale, null);
    assert.equal(ended.currentPrice, "10000");
    const planned = price(
      product({
        unasSnapshot: { ...base, saleStartsAt: at(24), saleEndsAt: at(48) },
      }),
    );
    assert.equal(planned.sale?.state, "tervezett");
    assert.equal(planned.currentPrice, "10000");
    assert.deepEqual(planned.omnibus, { status: "nincs futó akció" });
  });

  it("a product we own: the own price and the own sale window; the frozen mirror sale is not a sale", () => {
    const row = product({
      catalogAuthority: "ACROPORA",
      unasSnapshot: {
        grossPrice: D("1"),
        currency: null,
        saleGrossPrice: D("2"),
        saleStartsAt: null,
        saleEndsAt: null,
        productUrl: null,
      },
      variants: [
        variant({
          sellingGrossPrice: D("9000"),
          sellingPriceCurrency: "HUF",
        }),
      ],
    });
    const frozen = price(row);
    assert.equal(frozen.currentPrice, "9000");
    assert.equal(frozen.sale, null);
    assert.equal(frozen.priceSource, "Acropora OS");

    const running = price(
      product({
        ...row,
        variants: [
          variant({
            sellingGrossPrice: D("9000"),
            sellingPriceCurrency: "HUF",
            sellingSaleGrossPrice: D("7000"),
            sellingSaleStartsAt: at(-1),
            sellingSaleEndsAt: at(5),
          }),
        ],
      }),
    );
    assert.equal(running.currentPrice, "7000");
    assert.equal(running.sale?.state, "fut");
    assert.equal(running.sale?.openEnded, false);
  });

  it("an own sale whose end has come is gone at the end instant (half-open window)", () => {
    const p = price(
      product({
        catalogAuthority: "ACROPORA",
        variants: [
          variant({
            sellingGrossPrice: D("9000"),
            sellingPriceCurrency: "HUF",
            sellingSaleGrossPrice: D("7000"),
            sellingSaleStartsAt: at(-5),
            sellingSaleEndsAt: NOW,
          }),
        ],
      }),
    );
    assert.equal(p.sale, null);
    assert.equal(p.currentPrice, "9000");
  });

  it("the refusals are answers: unknown authority, no mirror row, no own price", () => {
    const reason = (row: ProductRow) =>
      (buildProductData(row, ctx()).variants[0]!.price as UnknownSection)
        .reason;
    assert.equal(
      reason(product({ catalogAuthority: null })),
      "authority-unknown",
    );
    assert.equal(reason(product({ unasSnapshot: null })), "mirror-row-missing");
    assert.equal(
      reason(product({ catalogAuthority: "ACROPORA" })),
      "own-price-missing",
    );
  });

  it("last change: the newest of the mirror rows and THIS variant's rows, other variants ignored; none is unknown", () => {
    const row = product({
      priceChanges: [
        { variantId: null, at: at(-100) },
        { variantId: "v1", at: at(-30) },
        { variantId: "other", at: at(-1) },
      ],
    });
    assert.equal(price(row).lastChangedAt, at(-30).toISOString());
    assert.equal(price(product()).lastChangedAt, "ismeretlen");
  });
});

describe("omnibus", () => {
  const running = product({
    unasSnapshot: {
      grossPrice: D("10000"),
      currency: null,
      saleGrossPrice: D("8000"),
      saleStartsAt: at(-24),
      saleEndsAt: at(24),
      productUrl: null,
    },
  });
  const lowest = (patch: Partial<LowestPrice> = {}): LowestPrice => ({
    amount: D("9500"),
    currency: "HUF",
    since: at(-800),
    windowStart: at(-744),
    reductionStart: at(-24),
    complete: true,
    unknownInWindow: false,
    historyBegins: at(-900),
    ...patch,
  });

  it("only variants whose sale RUNS need a reference", () => {
    assert.deepEqual(runningSaleVariantIds(running, NOW), ["v1"]);
    assert.deepEqual(runningSaleVariantIds(product(), NOW), []);
  });

  it("a known reference comes with its day and completeness", () => {
    const p = price(running, ctx(new Map([["v1", lowest()]])));
    assert.deepEqual(p.omnibus, {
      status: "ismert",
      amount: "9500",
      currency: "HUF",
      reductionStart: "2026-11-11",
      historyBegins: "2026-10-05",
      complete: true,
    });
  });

  it("a young history says so (complete false)", () => {
    const p = price(
      running,
      ctx(new Map([["v1", lowest({ complete: false })]])),
    );
    assert.equal(p.omnibus.status === "ismert" && p.omnibus.complete, false);
  });

  it("no number when the reference cannot be named: not computed, no price, a gap", () => {
    const reason = (map: Map<string, LowestPrice | null>) =>
      (price(running, ctx(map)).omnibus as UnknownSection).reason;
    assert.equal(reason(new Map()), "not-computed");
    assert.equal(
      reason(new Map([["v1", null]])),
      "no-known-price-before-the-reduction",
    );
    assert.equal(
      reason(new Map([["v1", lowest({ unknownInWindow: true })]])),
      "gap-in-the-30-day-window",
    );
  });
});

describe("stock", () => {
  it("available is on hand minus reserved, summed over the rows; not counted yet", () => {
    const s = stock({
      stockItems: [
        { onHand: D("5"), reserved: D("1"), updatedAt: at(-3) },
        { onHand: D("2"), reserved: D("0"), updatedAt: at(-1) },
      ],
    });
    assert.equal(s.quantity, 6);
    assert.equal(s.state, "van");
    assert.equal(s.reliability, "nem leltározott");
    assert.equal(s.lastCountedAt, "ismeretlen");
    assert.equal(s.lastUpdatedAt, at(-1).toISOString());
  });

  it("a zero is `nincs` but stays `nem leltározott` until a corrected count includes the variant", () => {
    const zero = [{ onHand: D("0"), reserved: D("0"), updatedAt: at(-1) }];
    const before = stock({ stockItems: zero });
    assert.equal(before.quantity, 0);
    assert.equal(before.state, "nincs");
    assert.equal(before.reliability, "nem leltározott");
    const after = stock({
      stockItems: zero,
      countedLines: [{ inventoryCount: { correctedAt: at(-72) } }],
    });
    assert.equal(after.reliability, "leltározott");
    assert.equal(after.lastCountedAt, at(-72).toISOString());
  });

  it("NO stock row is unknown, never zero", () => {
    const s = stock({ stockItems: [] });
    assert.equal(s.quantity, "ismeretlen");
    assert.equal(s.state, "ismeretlen");
    assert.equal(s.lastUpdatedAt, "ismeretlen");
  });

  it("a negative sum is unknown, not `nincs` and not a negative number", () => {
    const s = stock({
      stockItems: [{ onHand: D("1"), reserved: D("4"), updatedAt: at(-1) }],
    });
    assert.equal(s.quantity, "ismeretlen");
    assert.equal(s.state, "ismeretlen");
  });

  it("an untracked variant is `nem követett` with no number; a MISSING extension row is not untracked", () => {
    const untracked = stock({ extension: { stockTrackingEnabled: false } });
    assert.equal(untracked.state, "nem követett");
    assert.equal(untracked.quantity, "ismeretlen");
    assert.equal(stock({ extension: null }).state, "van");
  });
});

describe("arrivals", () => {
  it("an empty list says it is not exhaustive", () => {
    const a = buildProductData(product(), ctx()).variants[0]!.arrivals;
    assert.deepEqual(a, { status: "ismert", complete: false, recorded: [] });
  });

  it("order lines: remaining quantity, the line date over the order date, no supplier", () => {
    const row = product({
      variants: [
        variant({
          purchaseLines: [
            {
              orderedQuantity: D("10"),
              receivedQuantity: D("4"),
              expectedAt: null,
              purchaseOrder: { expectedAt: at(48), updatedAt: at(-5) },
            },
            {
              orderedQuantity: D("3"),
              receivedQuantity: D("3"),
              expectedAt: at(10),
              purchaseOrder: { expectedAt: null, updatedAt: at(-5) },
            },
          ],
        }),
      ],
    });
    const a = buildProductData(row, ctx()).variants[0]!.arrivals;
    assert.equal(a.status, "ismert");
    if (a.status !== "ismert") return;
    assert.equal(a.recorded.length, 1);
    assert.deepEqual(a.recorded[0], {
      source: "beszerzési rendelés",
      expectedOn: "2026-11-14",
      quantity: 6,
      state: "megrendelve",
      preorderable: "ismeretlen",
      updatedAt: at(-5).toISOString(),
    });
  });

  it("live-animal arrivals: state, pre-registration and an unknown quantity as unknown", () => {
    const row = product({
      livestockArrivals: [
        {
          expectedOn: new Date("2026-11-20"),
          quantity: null,
          status: "IN_TRANSIT",
          preorderable: true,
          updatedAt: at(-1),
        },
      ],
    });
    const a = buildProductData(row, ctx()).variants[0]!.arrivals;
    if (a.status !== "ismert") throw new Error("unexpected unknown");
    assert.equal(a.recorded[0]?.state, "úton");
    assert.equal(a.recorded[0]?.quantity, "ismeretlen");
    assert.equal(a.recorded[0]?.preorderable, true);
    assert.equal(a.recorded[0]?.expectedOn, "2026-11-20");
  });
});

describe("the rest of the product", () => {
  it("fulfilment comes from the shipping profile only; no profile is unknown", () => {
    const f = (profile: ProductRow["shippingProfile"]) =>
      buildProductData(product({ shippingProfile: profile }), ctx())
        .variants[0]!.fulfilment;
    assert.equal(f(null), "ismeretlen");
    assert.equal(
      f({ pickupOnly: true, isFrozen: false }),
      "csak bolti átvétel",
    );
    assert.equal(
      f({ pickupOnly: false, isFrozen: true }),
      "csak bolti átvétel",
    );
    assert.equal(f({ pickupOnly: false, isFrozen: false }), "szállítással");
  });

  it("a channel without a row is unknown, not unpublished; the URL falls back to the mirror", () => {
    const data = buildProductData(
      product({
        channelListings: [
          { channel: "UNAS", isPublished: true, productUrl: null },
        ],
        unasSnapshot: {
          grossPrice: D("1"),
          currency: null,
          saleGrossPrice: null,
          saleStartsAt: null,
          saleEndsAt: null,
          productUrl: "https://shop.example/p",
        },
      }),
      ctx(),
    );
    assert.deepEqual(data.channels.unas, {
      published: true,
      url: "https://shop.example/p",
    });
    assert.deepEqual(data.channels.webshop, {
      published: "ismeretlen",
      url: "ismeretlen",
    });
  });

  it("an archived or inactive product is `active: false`; livestock is flagged", () => {
    const data = buildProductData(
      product({ archivedAt: at(-1), type: "LIVESTOCK" }),
      ctx(),
    );
    assert.equal(data.active, false);
    assert.equal(data.livestock, true);
  });

  it("NOTHING internal can reach the answer: the keys are a closed list", () => {
    const json = JSON.stringify(buildProductData(product(), ctx()));
    for (const word of [
      "purchase",
      "supplier",
      "margin",
      "cost",
      "warehouse",
      "beszerz",
      "beszállít",
    ])
      assert.ok(!json.toLowerCase().includes(word), `leaked: ${word}`);
  });
});
