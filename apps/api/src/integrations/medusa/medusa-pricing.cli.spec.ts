import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import {
  describePricing,
  priceTargets,
  recordShownPrice,
  resolvePricingTargets,
  runPricingCli,
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
  sellingSaleGrossPrice?: Prisma.Decimal | null;
  sellingSaleStartsAt?: Date | null;
  sellingSaleEndsAt?: Date | null;
  unasVariantExtraGrossPrice: Prisma.Decimal | null;
}

function db(options: {
  variants?: VariantRow[];
  authority?: string | null;
  /*
    A TUKOR-SOR. Alapertelmezesben NINCS, mert ezek a tesztek tobbsegukben
    ACROPORA gazdaju termekrol szolnak, ahol a tukor nem is szamit. A UNAS agnak
    SAJAT allitasa van, sajat tukorrel.
  */
  mirror?: {
    productId: string;
    grossPrice: Prisma.Decimal | null;
    currency: string | null;
    saleGrossPrice: Prisma.Decimal | null;
    saleStartsAt: Date | null;
    saleEndsAt: Date | null;
  } | null;
}): PricingCliDatabase & { queries: unknown[] } {
  const queries: unknown[] = [];
  const variants = options.variants ?? [
    {
      id: "var-1",
      sku: "STAGEPROOF0002",
      productId: "prod-os-1",
      sellingGrossPrice: new Prisma.Decimal("12990"),
      sellingPriceCurrency: "HUF",
      unasVariantExtraGrossPrice: null,
    },
  ];

  return {
    queries,
    productVariant: {
      findMany: async (args: unknown) => {
        queries.push(args);
        return variants.map((variant) => ({
          sellingSaleGrossPrice: null,
          sellingSaleStartsAt: null,
          sellingSaleEndsAt: null,
          ...variant,
        }));
      },
    },
    productPriceHistory: {
      findFirst: async () => null,
      create: async (args: unknown) => {
        queries.push(args);
        return {};
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
    unasProductSnapshot: {
      findMany: async () => (options.mirror ? [options.mirror] : []),
    },
  };
}

describe("Ár-parancs: kit vetítünk", () => {
  it("a korlát nélküli tömeges indítást elutasítja, mielőtt bármit írna", async () => {
    const stderr: string[] = [];
    const code = await runPricingCli([], {
      stdout: () => undefined,
      stderr: (value) => stderr.push(value),
    });

    assert.equal(code, 1);
    assert.match(stderr.join(""), /kérj köteget a --limit kapcsolóval/);
  });

  it("cikkszámból megtalálja a változatot és az árát", async () => {
    const resolved = await resolvePricingTargets("sku:STAGEPROOF0002", db({}));

    assert.deepEqual(resolved.errors, []);
    assert.equal(resolved.targets.length, 1);
    assert.equal(resolved.targets[0]!.sku, "STAGEPROOF0002");
    assert.equal(resolved.targets[0]!.osProductId, "prod-os-1");
    assert.equal(resolved.targets[0]!.source, "own");
    assert.equal(
      resolved.targets[0]!.price.sellingGrossPrice?.toString(),
      "12990",
    );
    assert.equal(resolved.targets[0]!.price.sellingPriceCurrency, "HUF");
  });

  /**
   * A GAZDA-ELLENŐRZÉS ITT A LEGFONTOSABB: egy UNAS-gazdájú termék ára a UNAS
   * pillanatképben él. Ha ráfutnánk, a SAJÁT üres mezőnkből próbálnánk árat
   * vetíteni egy olyan termékre, aminek van ára - csak nem a miénk.
   */
  it("UNAS gazdánál a TÜKÖR ára megy, nem a mi üres mezőnk", async () => {
    /*
      EZ A (b) UT A PARANCS SZINTJEN (Balazs dontese, 2026-09-04). A valtozat
      sajat ara 12990, a tukore 7800 -- es UNAS gazdanal a TUKORE az igaz. A
      sajat mezo egy valodi UNAS-gazdaju termeknel amugy is ures; itt
      szandekosan NEM az, hogy a ket ar megkulonboztetheto legyen.

      MI PIROSIT: ha a parancs tovabbra is a sajat mezobol olvasna. Akkor
      12990 jonne vissza, es a forras "own" lenne.
    */
    const resolved = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({
        authority: "UNAS",
        mirror: {
          productId: "prod-os-1",
          grossPrice: new Prisma.Decimal("7800"),
          currency: "HUF",
          saleGrossPrice: null,
          saleStartsAt: null,
          saleEndsAt: null,
        },
      }),
    );

    assert.deepEqual(resolved.errors, []);
    assert.equal(resolved.targets[0]!.source, "mirror");
    assert.equal(
      resolved.targets[0]!.price.sellingGrossPrice?.toString(),
      "7800",
    );
  });

  it("UNAS gazda tükör-sor NÉLKÜL: megáll, és megnevezi az okát", async () => {
    const resolved = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ authority: "UNAS" }),
    );

    assert.deepEqual(resolved.targets, []);
    assert.match(resolved.errors.join(""), /mirror-row-missing/);
  });

  it("ismeretlen gazda ugyanúgy kizár (fail-closed)", async () => {
    const resolved = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ authority: null }),
    );

    assert.deepEqual(resolved.targets, []);
    assert.match(resolved.errors.join(""), /authority-unknown/);
  });

  it("nincs ilyen cikkszám: hibaüzenet, nem üres siker", async () => {
    const resolved = await resolvePricingTargets(
      "sku:nincsilyen",
      db({ variants: [] }),
    );

    assert.deepEqual(resolved.targets, []);
    assert.match(
      resolved.errors.join(""),
      /nincs ilyen cikkszámú aktív változat/,
    );
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
    assert.equal(select.sellingSaleGrossPrice, true);
    assert.equal(select.sellingSaleStartsAt, true);
    assert.equal(select.sellingSaleEndsAt, true);
  });
});

/*
  A SAJÁT AKCIÓ A PARANCSBAN (T4.1-D3, akció 2. szelet). MI PIROSÍT: a futó
  saját akció mellett a rendes ár megy; az előzmény képe nem a bolti árat
  hordozza (akció alatt az akciós árat is); a tükörből vetített ár saját sort
  ír; vagy a rögzítő tükör-célpontnál adatbázishoz nyúl.
*/
describe("Ár-parancs: a saját akció", () => {
  const MOST = new Date("2026-11-12T10:00:00Z");
  const akcios = {
    id: "var-1",
    sku: "STAGEPROOF0002",
    productId: "prod-os-1",
    sellingGrossPrice: new Prisma.Decimal("12990"),
    sellingPriceCurrency: "HUF",
    sellingSaleGrossPrice: new Prisma.Decimal("9990"),
    sellingSaleStartsAt: new Date("2026-11-10T00:00:00Z"),
    sellingSaleEndsAt: new Date("2026-11-17T00:00:00Z"),
    unasVariantExtraGrossPrice: null,
  };

  it("futó akciónál az akciós ár megy, és az előzmény képe a rendes és az akciós ár", async () => {
    const { targets } = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ variants: [akcios] }),
      MOST,
    );
    assert.equal(targets[0]!.source, "own-sale");
    assert.equal(targets[0]!.price.sellingGrossPrice?.toString(), "9990");
    assert.deepEqual(
      {
        ...targets[0]!.ownHistory,
        grossPrice: targets[0]!.ownHistory?.grossPrice.toString(),
        saleGrossPrice: targets[0]!.ownHistory?.saleGrossPrice?.toString(),
      },
      {
        variantId: "var-1",
        currency: "HUF",
        grossPrice: "12990",
        saleGrossPrice: "9990",
      },
    );
  });

  it("az akció vége után a rendes ár megy, és az előzmény képe akció nélküli", async () => {
    const { targets } = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ variants: [akcios] }),
      new Date("2026-11-17T00:00:00Z"),
    );
    assert.equal(targets[0]!.source, "own");
    assert.equal(targets[0]!.price.sellingGrossPrice?.toString(), "12990");
    assert.equal(targets[0]!.ownHistory?.saleGrossPrice, null);
  });

  it("a tükörből vetített árnak nincs saját előzmény-képe, és a rögzítő nem ír", async () => {
    const { targets } = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({
        authority: "UNAS",
        mirror: {
          productId: "prod-os-1",
          grossPrice: new Prisma.Decimal("7800"),
          currency: null,
          saleGrossPrice: null,
          saleStartsAt: null,
          saleEndsAt: null,
        },
      }),
      MOST,
    );
    assert.equal(targets[0]!.ownHistory, null);
    let hivas = 0;
    const tx = {
      productPriceHistory: {
        findFirst: async () => {
          hivas += 1;
          return null;
        },
        create: async () => {
          hivas += 1;
          return {};
        },
      },
    };
    assert.equal(await recordShownPrice(tx, targets[0]!, MOST), "mirror");
    assert.equal(hivas, 0);
  });

  it("a saját ár sora OWN, a változaton, a bolti akciós árral, a rögzítés idejével", async () => {
    const { targets } = await resolvePricingTargets(
      "sku:STAGEPROOF0002",
      db({ variants: [akcios] }),
      MOST,
    );
    const irt: unknown[] = [];
    const tx = {
      productPriceHistory: {
        findFirst: async () => null,
        create: async (args: unknown) => {
          irt.push(args);
          return {};
        },
      },
    };
    assert.equal(await recordShownPrice(tx, targets[0]!, MOST), "written");
    const data = (irt[0] as { data: Record<string, unknown> }).data;
    assert.equal(data.source, "OWN");
    assert.equal(data.variantId, "var-1");
    assert.equal(String(data.grossPrice), "12990");
    assert.equal(String(data.saleGrossPrice), "9990");
    assert.equal((data.observedAt as Date).getTime(), MOST.getTime());
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
    source: "own",
    surcharge: null,
    result: "updated",
  };

  /**
   * A FELAR SORA CSAK AKKOR ALL OTT, HA VAN FELAR -- ES MINDKET IRANYRA VAN
   * ALLITAS.
   *
   * Ha csak a megjeleneset mernenk, egy olyan valtozat is atmenne, ami MINDIG
   * kiirja (akar "nincs" ertekkel), es akkor a sor puszta megjelenese nem
   * jelentene semmit. A jelzes epp az, hogy hianyzik, amikor nincs felar.
   */
  it("a felár sora ott áll, ha van felár", () => {
    const text = describePricing({
      ...report,
      source: "mirror",
      sourceAmount: "7950",
      surcharge: "150",
    });

    assert.match(text, /felar: 150 HUF \(a valtozate\)/);
  });

  it("és NEM áll ott, ha nincs felár", () => {
    assert.doesNotMatch(describePricing(report), /felar:/);
  });

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

  /**
   * A FORRAS MEGNEVEZESE acrobot kikotese (2026-09-04): enelkul egy kesobbi
   * olvaso nem tudja eldonteni, MIERT regi egy ar. Egy befagyott tukor-ar es
   * egy elavult sajat ar a jelentesben kulonben ugyanugy nez ki.
   *
   * MI PIROSIT: ha a `forras:` sor visszaall allandora.
   */
  it("a jelentés megnevezi a forrást, és a kettő MÁS sort ad", () => {
    const sajat = describePricing(report);
    const tukor = describePricing({ ...report, source: "mirror" });

    assert.match(sajat, /forras: Acropora OS/);
    assert.match(tukor, /forras: UNAS tükör/);
    assert.notEqual(sajat, tukor);
  });
});

/*
  A TERMÉKENKÉNTI KUDARC JELZÉSE (329f8a2e). Az ütemező ebből tudja, melyik
  termék ára bukott el. MI PIROSIT: egy feloldási hiba vagy egy megállt változat
  nem jelez; egy sikeres termék jelez; a jelzés nem a hívó azonosítójával jön.
*/
describe("Ár-parancs: a kudarc termékenként jelződik", () => {
  const cel = (osProductId: string, sku: string) =>
    ({
      osProductId,
      sku,
      source: "own",
      surcharge: null,
      price: { sellingGrossPrice: null, sellingPriceCurrency: "HUF" },
    }) as never;

  it("feloldási hiba és megállt változat jelez, a sikeres termék nem", async () => {
    const jelzett: [string, string][] = [];
    const kod = await priceTargets(
      ["prod-ok", "prod-feloldas", "prod-megallt"],
      {
        resolve: async (argument) =>
          argument === "prod-feloldas"
            ? { targets: [], errors: ["prod-feloldas: nincs kotes"] }
            : { targets: [cel(argument, `${argument}-sku`)], errors: [] },
        record: async () => "mirror",
        project: async (target) =>
          (target as { sku: string }).sku === "prod-megallt-sku"
            ? {
                action: "stopped" as const,
                reason: "tax-inclusive-not-set" as never,
                details: "a regio adobeallitasa",
              }
            : {
                action: "projected" as const,
                report: {
                  sku: "prod-ok-sku",
                  sourceAmount: "1000",
                  sourceCurrency: "HUF",
                  medusaAmount: 1000,
                  medusaCurrencyCode: "huf",
                  variantId: "variant_1",
                  priceId: "price_1",
                  source: "own",
                  surcharge: null,
                  result: "updated",
                },
              },
      },
      {
        stdout: () => {},
        stderr: () => {},
        failed: (target, reason) => jelzett.push([target, reason]),
      },
    );
    assert.equal(kod, 1);
    assert.deepEqual(jelzett, [
      ["prod-feloldas", "prod-feloldas: nincs kotes"],
      ["prod-megallt", "prod-megallt-sku: tax-inclusive-not-set"],
    ]);
  });

  /*
    AZ ELŐZMÉNY A BOLT ÍRÁSA UTÁN (T4.1-D3). MI PIROSÍT: a megállt változat
    előzmény-sort kap (a bolt nem mutatja az árat); a sikeres nem kap; vagy az
    előzmény bukása sikerként megy át (a termék nem marad esedékes).
  */
  it("az előzmény csak a kiment árra íródik, és a bukása kudarc", async () => {
    const rogzitett: string[] = [];
    const jelzett: [string, string][] = [];
    const stdout: string[] = [];
    const kod = await priceTargets(
      ["prod-ok", "prod-megallt", "prod-elozmeny"],
      {
        resolve: async (argument) => ({
          targets: [cel(argument, `${argument}-sku`)],
          errors: [],
        }),
        record: async (target) => {
          if (target.sku === "prod-elozmeny-sku")
            throw new TypeError("adatbazis");
          rogzitett.push(target.sku);
          return "written";
        },
        project: async (target) =>
          target.sku === "prod-megallt-sku"
            ? {
                action: "stopped" as const,
                reason: "tax-inclusive-not-set" as never,
                details: "a regio adobeallitasa",
              }
            : {
                action: "projected" as const,
                report: {
                  sku: target.sku,
                  sourceAmount: "1000",
                  sourceCurrency: "HUF",
                  medusaAmount: 1000,
                  medusaCurrencyCode: "huf",
                  variantId: "variant_1",
                  priceId: "price_1",
                  source: "own",
                  surcharge: null,
                  result: "no-change",
                },
              },
      },
      {
        stdout: (value) => stdout.push(value),
        stderr: () => {},
        failed: (target, reason) => jelzett.push([target, reason]),
      },
    );
    assert.equal(kod, 1);
    assert.deepEqual(rogzitett, ["prod-ok-sku"]);
    assert.deepEqual(jelzett, [
      ["prod-megallt", "prod-megallt-sku: tax-inclusive-not-set"],
      ["prod-elozmeny", "prod-elozmeny-sku: price-history-not-written"],
    ]);
    assert.equal(stdout.filter((sor) => sor.startsWith("prod-")).length, 1);
  });
});
