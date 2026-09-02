import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  describePricing,
  resolvePricingTargets,
  type PricingCliDatabase,
} from "./medusa-pricing.cli.js";
import type { PricingProjectionReport } from "./medusa-pricing-projection.service.js";

/**
 * A parancs KÉT szabálya, hálózat és adatbázis nélkül: kit vetítünk, és mit
 * írunk ki róla.
 */

interface VariantRow {
  id: string;
  sku: string;
  productId: string;
  sellingGrossPrice: Prisma.Decimal | null;
  sellingPriceCurrency: string | null;
}

function db(options: {
  variants?: VariantRow[];
  authority?: string | null;
}): PricingCliDatabase & { queries: unknown[] } {
  const queries: unknown[] = [];
  const variants = options.variants ?? [
    {
      id: "var-1",
      sku: "STAGEPROOF0002",
      productId: "prod-os-1",
      sellingGrossPrice: new Prisma.Decimal("12990"),
      sellingPriceCurrency: "HUF",
    },
  ];

  return {
    queries,
    productVariant: {
      findMany: async (args: unknown) => {
        queries.push(args);
        return variants;
      },
    },
    product: {
      findMany: async () => [
        {
          id: "prod-os-1",
          catalogAuthority:
            options.authority === undefined ? "ACROPORA" : options.authority,
        },
      ],
    },
  };
}

describe("Ár-parancs: kit vetítünk", () => {
  it("cikkszámból megtalálja a változatot és az árát", async () => {
    const resolved = await resolvePricingTargets("sku:STAGEPROOF0002", db({}));

    assert.ok(!("error" in resolved));
    if ("error" in resolved) return;
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.sku, "STAGEPROOF0002");
    assert.equal(resolved[0]!.osProductId, "prod-os-1");
    assert.equal(resolved[0]!.price.sellingGrossPrice?.toString(), "12990");
    assert.equal(resolved[0]!.price.sellingPriceCurrency, "HUF");
  });

  /**
   * A GAZDA-ELLENŐRZÉS ITT A LEGFONTOSABB: egy UNAS-gazdájú termék ára a UNAS
   * pillanatképben él. Ha ráfutnánk, a SAJÁT üres mezőnkből próbálnánk árat
   * vetíteni egy olyan termékre, aminek van ára - csak nem a miénk.
   */
  it("UNAS-gazdájú terméket IS vetít (ar-vetítés)", async () => {
    const resolved = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ authority: "UNAS" }),
    );

    assert.ok(
      !("error" in resolved),
      "a UNAS gazda 2026-09-02 óta nem szűr az ár-vetítésben sem",
    );
  });

  it("ismeretlen gazda ugyanúgy kizár (fail-closed)", async () => {
    const resolved = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ authority: null }),
    );

    assert.ok("error" in resolved);
  });

  it("nincs ilyen cikkszám: hibaüzenet, nem üres siker", async () => {
    const resolved = await resolvePricingTargets(
      "sku:nincsilyen",
      db({ variants: [] }),
    );

    assert.ok("error" in resolved);
    if (!("error" in resolved)) return;
    assert.match(resolved.error, /nincs ilyen cikkszámú aktív változat/);
  });

  /**
   * AZ ÁR MEZŐI BENNE VANNAK A LEKÉRDEZÉSBEN. Ha kimaradnának, a parancs
   * mindig „nincs ár" megállást adna - és az a megállás ÜZENETBEN helyesnek
   * látszana, tehát senki nem keresné a lekérdezésben.
   */
  it("a lekérdezés kikéri az ár mezőit", async () => {
    const database = db({});
    await resolvePricingTargets("sku:STAGEPROOF0002", database);

    const select = (database.queries[0] as { select: Record<string, boolean> })
      .select;
    assert.equal(select.sellingGrossPrice, true);
    assert.equal(select.sellingPriceCurrency, true);
  });
});

describe("Ár-parancs: mit ír ki", () => {
  const report: PricingProjectionReport = {
    sku: "STAGEPROOF0002",
    sourceAmount: "12990",
    sourceCurrency: "HUF",
    medusaAmount: 12990,
    medusaCurrencyCode: "huf",
    variantId: "variant_1",
    priceId: "price_1",
    result: "updated",
  };

  it("a brief kért sorai mind ott vannak", () => {
    const text = describePricing(report);

    for (const needle of [
      "forras: Acropora OS",
      "ar: 12990 HUF brutto",
      "medusa amount: 12990 huf",
      "valtozat: variant_1",
      "eredmeny: updated",
    ])
      assert.match(
        text,
        new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
  });

  /**
   * AZ ÁR AZONOSÍTÓJA KÜLÖN ÁLLÍTÁS, mert ez a kör mércéje. Ha a jelentésből
   * kimaradna, a futtató a darabszámra lenne utalva - az pedig akkor is
   * egyet mutat, ha minden futás újraépíti az árat.
   */
  it("kiírja az ár azonosítóját", () => {
    assert.match(describePricing(report), /ar-azonosito: price_1/);
  });
});
