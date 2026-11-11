import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CUSTOMER_CANDIDATE_PARAMETERS,
  CUSTOMER_CANDIDATES_PER_PARAMETER,
  CUSTOMER_CANDIDATE_MOVES,
  CustomerCandidateSource,
  customerMatchingRows,
  customerWantedMoves,
  limitCustomerCandidates,
  type CustomerRecommendationCandidate,
} from "./customer-candidate-source.js";
import type { JevEffectRow } from "./jev-candidate-source.js";

/**
 * A VEVŐI JELÖLT-FORRÁS (kártya ce6c5cc9, V3.4 S2). MI PIROSÍT: egy UNVERIFIED (saját adatú) hatás a vevő elé kerül, megjelöléssel
 * is; hivatkozás nélküli vagy nem https hatás jelölt; a foszfát (vagy bármely nem jóváhagyott paraméter) bekerül; inaktív vagy nem
 * vásárolható termék jelölt; egy paraméterhez 5-nél több termék megy; a rossz irányba vivő termék jelölt; kívánt mozgás nélkül
 * lekérdez; a belső forrás olyat is átenged, amit ez nem.
 */
const URL = "https://gyarto.example/termek";
const SELLS = [{ channel: "UNAS", externalStatus: "1" }];
const row = (over: Partial<JevEffectRow>): JevEffectRow => ({
  productId: "p",
  status: "VERIFIED",
  value: "KALCIUM:EMEL",
  currentValue: null,
  sourceRef: URL,
  ...over,
});
const low = (parameterCode: string) => ({
  parameterCode,
  direction: "EMEL" as const,
});
const high = (parameterCode: string) => ({
  parameterCode,
  direction: "CSOKKENT" as const,
});

describe("the moves the customer path may act on", () => {
  it("only the four parameters approved for a customer; phosphate and the rest are dropped", () => {
    assert.deepEqual(
      [...CUSTOMER_CANDIDATE_PARAMETERS],
      ["KH", "KALCIUM", "MAGNEZIUM", "NITRAT"],
    );
    const wanted = customerWantedMoves([
      low("KH"),
      high("NITRAT"),
      low("FOSZFAT"),
      high("FOSZFAT"),
      low("PH"),
      low("SOTARTALOM"),
    ]);
    assert.deepEqual(
      [...wanted],
      [
        ["KH", "EMEL"],
        ["NITRAT", "CSOKKENT"],
      ],
    );
    assert.equal(customerWantedMoves([]).size, 0);
    assert.equal(customerWantedMoves([low("FOSZFAT")]).size, 0);
  });
});

describe("the rows that may reach a customer", () => {
  const wanted = customerWantedMoves([low("KALCIUM")]);

  it("a VERIFIED value moving the wanted parameter the right way, with an https reference", () => {
    assert.deepEqual(customerMatchingRows([row({})], wanted), [
      {
        productId: "p",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        sideEffects: [],
        evidenceRef: URL,
      },
    ]);
  });

  it("an UNVERIFIED effect (our own data) NEVER reaches a customer, with or without a value of its own, marked or not", () => {
    for (const unverified of [
      row({ status: "UNVERIFIED", value: null, currentValue: "KALCIUM:EMEL" }),
      row({
        status: "UNVERIFIED",
        value: "KALCIUM:EMEL",
        currentValue: "KALCIUM:EMEL",
      }),
      row({
        status: "UNVERIFIED",
        value: null,
        currentValue: "KALCIUM:EMEL",
        sourceRef: URL,
      }),
    ])
      assert.deepEqual(customerMatchingRows([unverified], wanted), []);
  });

  it("every other status is no candidate, and a VERIFIED row without a value is none", () => {
    for (const status of [
      "CONFLICT",
      "SUGGESTED",
      "LIKELY_WRONG",
      "UNKNOWN",
      "",
    ])
      assert.deepEqual(
        customerMatchingRows([row({ status })], wanted),
        [],
        status,
      );
    assert.deepEqual(customerMatchingRows([row({ value: null })], wanted), []);
    assert.deepEqual(customerMatchingRows([row({ value: "" })], wanted), []);
  });

  it("without the maker's reference, or with one that is not https, there is no candidate: the customer would get no source to rely on", () => {
    for (const sourceRef of [
      null,
      "",
      "   ",
      "http://gyarto.example/termek",
      "gyarto.example/termek",
      "ftp://x/y",
      "javascript:alert(1)",
      "https://a b",
    ])
      assert.deepEqual(
        customerMatchingRows([row({ sourceRef })], wanted),
        [],
        String(sourceRef),
      );
  });

  it("the wrong direction, an unwanted parameter and a product that moves another deviation the wrong way are no candidates", () => {
    assert.deepEqual(
      customerMatchingRows([row({ value: "KALCIUM:CSOKKENT" })], wanted),
      [],
    );
    assert.deepEqual(
      customerMatchingRows([row({ value: "MAGNEZIUM:EMEL" })], wanted),
      [],
    );
    const both = customerWantedMoves([low("KALCIUM"), high("MAGNEZIUM")]);
    assert.deepEqual(
      customerMatchingRows(
        [row({ value: "KALCIUM:EMEL;MAGNEZIUM:EMEL" })],
        both,
      ),
      [],
    );
  });

  it("an unreadable value drops only its own row", () => {
    const rows = [
      row({ productId: "bad", value: "nonsense" }),
      row({ productId: "good" }),
    ];
    assert.deepEqual(
      customerMatchingRows(rows, wanted).map((match) => match.productId),
      ["good"],
    );
  });

  it("an effect on a parameter with no approved band (phosphate, pH) is NOT dropped: it goes on as a SIDE EFFECT with its direction, and the effects keep only the approved parameters (barracuda on #2415)", () => {
    const match = customerMatchingRows(
      [row({ value: "KALCIUM:EMEL;FOSZFAT:CSOKKENT;PH:EMEL" })],
      wanted,
    );
    assert.deepEqual(match[0]?.effects, [
      { parameterCode: "KALCIUM", direction: "EMEL" },
    ]);
    assert.deepEqual(match[0]?.sideEffects, [
      { parameterCode: "FOSZFAT", direction: "CSOKKENT" },
      { parameterCode: "PH", direction: "EMEL" },
    ]);
  });

  it("a product with no effect on an unapproved parameter has no side effects (an empty list, not a missing field)", () => {
    const match = customerMatchingRows([row({})], wanted);
    assert.deepEqual(match[0]?.sideEffects, []);
  });
});

describe("the cap per parameter", () => {
  const candidate = (
    productId: string,
    name: string,
    effects: CustomerRecommendationCandidate["effects"],
  ): CustomerRecommendationCandidate => ({
    productId,
    name,
    category: "K",
    effects,
    sideEffects: [],
    evidenceRef: URL,
    shopUrl: null,
  });

  it("at most five per parameter; the ones helping more wanted deviations first, then by name", () => {
    assert.equal(CUSTOMER_CANDIDATES_PER_PARAMETER, 5);
    const wanted = customerWantedMoves([low("KALCIUM"), low("MAGNEZIUM")]);
    const calcium = Array.from({ length: 8 }, (_, index) =>
      candidate(`c${index}`, `Kalcium ${String.fromCharCode(65 + index)}`, [
        { parameterCode: "KALCIUM", direction: "EMEL" },
      ]),
    );
    const both = candidate("both", "Zzz kettős", [
      { parameterCode: "KALCIUM", direction: "EMEL" },
      { parameterCode: "MAGNEZIUM", direction: "EMEL" },
    ]);
    const kept = limitCustomerCandidates([...calcium, both], wanted);
    const calciumKept = kept.filter((entry) =>
      entry.effects.some((effect) => effect.parameterCode === "KALCIUM"),
    );
    assert.equal(calciumKept.length, 5);
    // the one helping two deviations survives the cap although its name sorts last
    assert.ok(kept.some((entry) => entry.productId === "both"));
    // the others are the first four by name
    assert.deepEqual(calciumKept.map((entry) => entry.productId).sort(), [
      "both",
      "c0",
      "c1",
      "c2",
      "c3",
    ]);
  });

  it("a product is listed once however many parameters it serves, and the cap is per parameter, not overall", () => {
    const wanted = customerWantedMoves([low("KALCIUM"), low("MAGNEZIUM")]);
    const mg = Array.from({ length: 6 }, (_, index) =>
      candidate(`m${index}`, `Magnézium ${index}`, [
        { parameterCode: "MAGNEZIUM", direction: "EMEL" },
      ]),
    );
    const ca = Array.from({ length: 6 }, (_, index) =>
      candidate(`c${index}`, `Kalcium ${index}`, [
        { parameterCode: "KALCIUM", direction: "EMEL" },
      ]),
    );
    const kept = limitCustomerCandidates([...mg, ...ca], wanted);
    assert.equal(kept.length, 10);
    assert.equal(new Set(kept.map((entry) => entry.productId)).size, 10);
    assert.deepEqual(limitCustomerCandidates([], wanted), []);
    assert.deepEqual(limitCustomerCandidates(ca, wanted, 0), []);
  });
});

describe("the source", () => {
  const source = (
    rows: JevEffectRow[],
    products: unknown[],
    counters = { queries: 0, products: 0 },
  ) => {
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => {
        counters.queries++;
        return rows;
      },
      product: {
        findMany: async () => {
          counters.products++;
          return products;
        },
      },
    };
    return instance;
  };
  const product = (
    id: string,
    name: string,
    over: Record<string, unknown> = {},
  ) => ({
    id,
    name,
    categories: [{ category: { name: "Adalékok" } }],
    channelListings: SELLS,
    unasSnapshot: null,
    ...over,
  });

  it("no wanted move, or only an unapproved parameter, makes no query at all", async () => {
    const counters = { queries: 0, products: 0 };
    const instance = source([row({})], [product("p", "Kalcium")], counters);
    assert.deepEqual(await instance.candidates({ moves: [] }), []);
    assert.deepEqual(
      await instance.candidates({ moves: [low("FOSZFAT")] }),
      [],
    );
    assert.equal(counters.queries, 0);
  });

  it("returns the active, purchasable product with its category and the maker's reference, and nothing about 'unverified' or a basis", async () => {
    const instance = source([row({})], [product("p", "Kalcium adalék")]);
    assert.deepEqual(await instance.candidates({ moves: [low("KALCIUM")] }), [
      {
        productId: "p",
        name: "Kalcium adalék",
        category: "Adalékok",
        effects: [{ parameterCode: "KALCIUM", direction: "EMEL" }],
        sideEffects: [],
        evidenceRef: URL,
        shopUrl: null,
      },
    ]);
  });

  it("an UNVERIFIED match does not reach the customer, so the product query is not even made", async () => {
    const counters = { queries: 0, products: 0 };
    const instance = source(
      [
        row({
          status: "UNVERIFIED",
          value: null,
          currentValue: "KALCIUM:EMEL",
        }),
      ],
      [product("p", "Saját adatú")],
      counters,
    );
    assert.deepEqual(
      await instance.candidates({ moves: [low("KALCIUM")] }),
      [],
    );
    assert.equal(counters.queries, 1);
    assert.equal(counters.products, 0);
  });

  it("an inactive product (the query asks for active ones) and the ones one cannot buy drop out", async () => {
    let where: unknown;
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => [
        row({ productId: "ok" }),
        row({ productId: "status3" }),
        row({ productId: "inquire" }),
        row({ productId: "nolisting" }),
      ],
      product: {
        findMany: async (args: { where: unknown }) => {
          where = args.where;
          return [
            product("ok", "Megvehető"),
            product("status3", "Nem vásárolható", {
              channelListings: [{ channel: "UNAS", externalStatus: "3" }],
            }),
            product("inquire", "Csak érdeklődés", {
              unasSnapshot: { rawPayload: { Inquire: "1" } },
            }),
            product("nolisting", "Nincs UNAS sor", { channelListings: [] }),
          ];
        },
      },
    };
    const result = await instance.candidates({ moves: [low("KALCIUM")] });
    assert.deepEqual(
      result.map((entry) => entry.productId),
      ["ok"],
    );
    assert.deepEqual(where, {
      id: { in: ["ok", "status3", "inquire", "nolisting"] },
      isActive: true,
    });
  });

  it("applies the per-parameter cap", async () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      row({ productId: `p${index}` }),
    );
    const products = rows.map((entry, index) =>
      product(entry.productId, `Termék ${index}`),
    );
    const result = await source(rows, products).candidates({
      moves: [low("KALCIUM")],
    });
    assert.equal(result.length, CUSTOMER_CANDIDATES_PER_PARAMETER);
  });
});

describe("the shop address of a candidate (V3.4 S2b)", () => {
  const withListing = (listing: Record<string, unknown>) => {
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => [row({})],
      product: {
        findMany: async () => [
          {
            id: "p",
            name: "Kalcium",
            categories: [{ category: { name: "Adalékok" } }],
            channelListings: [listing],
            unasSnapshot: null,
          },
        ],
      },
    };
    return instance;
  };

  it("is the UNAS channel row's address when the product is visible in the shop, else null", async () => {
    const shown = await withListing({
      channel: "UNAS",
      externalStatus: "1",
      productUrl: "https://shop.example/kalcium",
    }).candidates({ moves: [low("KALCIUM")] });
    assert.equal(shown[0]?.shopUrl, "https://shop.example/kalcium");
    for (const listing of [
      { channel: "UNAS", externalStatus: "1", productUrl: null },
      {
        channel: "UNAS",
        externalStatus: "1",
        productUrl: "javascript:alert(1)",
      },
      {
        channel: "UNAS",
        externalStatus: "1",
        productUrl: "ftp://shop.example/x",
      },
    ]) {
      const result = await withListing(listing).candidates({
        moves: [low("KALCIUM")],
      });
      assert.equal(result[0]?.shopUrl, null, JSON.stringify(listing));
    }
  });
});

describe("candidatesByMove: every approved parameter in both directions, from one state", () => {
  const rows = [
    row({ productId: "ca-up", value: "KALCIUM:EMEL" }),
    row({ productId: "ca-down", value: "KALCIUM:CSOKKENT" }),
    row({ productId: "no3-down", value: "NITRAT:CSOKKENT" }),
    row({ productId: "po4-down", value: "FOSZFAT:CSOKKENT" }),
    row({
      productId: "unverified",
      status: "UNVERIFIED",
      value: null,
      currentValue: "KH:EMEL",
    }),
  ];
  const product = (id: string) => ({
    id,
    name: `Termék ${id}`,
    categories: [{ category: { name: "K" } }],
    channelListings: SELLS,
    unasSnapshot: null,
  });

  it("covers the four approved parameters and both directions, in the fixed order, and asks the database once for each kind", async () => {
    const counters = { queries: 0, products: 0 };
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => {
        counters.queries++;
        return rows;
      },
      product: {
        findMany: async () => {
          counters.products++;
          return ["ca-up", "ca-down", "no3-down", "po4-down", "unverified"].map(
            product,
          );
        },
      },
    };
    const result = await instance.candidatesByMove();
    assert.equal(CUSTOMER_CANDIDATE_MOVES.length, 8);
    assert.deepEqual(
      result.map((entry) => [entry.parameterCode, entry.direction]),
      CUSTOMER_CANDIDATE_MOVES.map((move) => [
        move.parameterCode,
        move.direction,
      ]),
    );
    assert.deepEqual(counters, { queries: 1, products: 1 });
    const by = (parameter: string, direction: string) =>
      result
        .find(
          (entry) =>
            entry.parameterCode === parameter && entry.direction === direction,
        )!
        .candidates.map((candidate) => candidate.productId);
    assert.deepEqual(by("KALCIUM", "EMEL"), ["ca-up"]);
    assert.deepEqual(by("KALCIUM", "CSOKKENT"), ["ca-down"]);
    assert.deepEqual(by("NITRAT", "CSOKKENT"), ["no3-down"]);
    assert.deepEqual(by("NITRAT", "EMEL"), []);
    assert.deepEqual(by("KH", "EMEL"), []);
    assert.deepEqual(by("MAGNEZIUM", "CSOKKENT"), []);
  });

  it("phosphate is not among the moves, so a phosphate product never appears; an unverified effect appears nowhere", async () => {
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => rows,
      product: {
        findMany: async () => ["ca-up", "po4-down", "unverified"].map(product),
      },
    };
    const result = await instance.candidatesByMove();
    assert.ok(result.every((entry) => entry.parameterCode !== "FOSZFAT"));
    const all = result.flatMap((entry) =>
      entry.candidates.map((candidate) => candidate.productId),
    );
    assert.ok(!all.includes("po4-down"));
    assert.ok(!all.includes("unverified"));
  });

  it("with no matching effect at all it returns the eight moves with empty lists and makes no product query", async () => {
    let products = 0;
    const instance = new CustomerCandidateSource();
    (instance as unknown as { database: unknown }).database = {
      $queryRaw: async () => [],
      product: {
        findMany: async () => {
          products++;
          return [];
        },
      },
    };
    const result = await instance.candidatesByMove();
    assert.equal(result.length, 8);
    assert.ok(result.every((entry) => entry.candidates.length === 0));
    assert.equal(products, 0);
  });
});
